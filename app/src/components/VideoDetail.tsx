import { useEffect, useMemo, useRef, useState } from "react";
import {
  captionsUrl,
  deleteVideo,
  getVideo,
  mediaUrl,
  retryVideo,
  type Status,
  type Video,
} from "../api";
import ExportCaptions from "./ExportCaptions";
import {
  formatClock,
  isWorking,
  languageName,
  PACE_LABEL,
  STATUS_LABEL,
  statusText,
} from "../format";

interface Props {
  /** Row from the list; its status/updated_at changing triggers a reload. */
  summary: Video;
  onChanged: () => void;
  onDeleted: () => void;
}

const SPEECH_STEPS: Status[] = ["queued", "extracting_audio", "transcribing", "analyzing"];
// Silent videos skip transcription and read the screen instead.
const VISUAL_STEPS: Status[] = ["queued", "extracting_audio", "reading_screen"];

export default function VideoDetail({ summary, onChanged, onDeleted }: Props) {
  const [video, setVideo] = useState<Video>(summary);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const activeRow = useRef<HTMLLIElement>(null);

  // Load full details (with result) whenever the job's state changes.
  useEffect(() => {
    let alive = true;
    getVideo(summary.id).then((v) => alive && setVideo(v)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [summary.id, summary.status, summary.updated_at]);

  // Load captions as a blob so <track> works across origins (desktop app).
  useEffect(() => {
    if (video.status !== "done") return;
    let url: string | null = null;
    fetch(captionsUrl(video.id, "vtt"))
      .then((r) => r.text())
      .then((text) => {
        url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        setVttUrl(url);
      })
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [video.id, video.status]);

  const result = video.result;
  const segments = result?.segments ?? [];
  const activeIndex = segments.findIndex((s) => currentMs >= s.start_ms && currentMs < s.end_ms);

  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return segments
      .map((s, i) => ({ ...s, i }))
      .filter((s) => !q || s.text.toLowerCase().includes(q));
  }, [segments, query]);

  function seek(ms: number) {
    if (!player.current) return;
    player.current.currentTime = ms / 1000;
    player.current.play().catch(() => {});
  }

  async function remove() {
    if (!confirm(`Delete "${video.filename}" and its results?`)) return;
    await deleteVideo(video.id);
    onDeleted();
  }

  async function retry() {
    await retryVideo(video.id);
    onChanged();
  }

  async function copyText() {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const steps = video.status === "reading_screen" ? VISUAL_STEPS : SPEECH_STEPS;
  const stepIndex = steps.indexOf(video.status);
  const visual = result?.mode === "visual";

  return (
    <div className="detail">
      <div className="card">
        <div className="detail-head">
          <h2 className="truncate" title={video.filename}>
            {video.filename}
          </h2>
          <span className={`chip ${video.status}`}>
            {isWorking(video.status) && <span className="spinner" />}
            {statusText(video.status, video.progress)}
          </span>
        </div>

        <video
          ref={player}
          className="player"
          src={mediaUrl(video.id)}
          controls
          preload="metadata"
          onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
        >
          {vttUrl && (
            <track
              kind="subtitles"
              src={vttUrl}
              srcLang={result?.language ?? "en"}
              label="Captions"
              default
            />
          )}
        </video>

        {isWorking(video.status) && (
          <ol className="steps" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
            {steps.map((s, i) => (
              <li key={s} className={i < stepIndex ? "done" : i === stepIndex ? "current" : ""}>
                {i === stepIndex ? statusText(s, video.progress) : STATUS_LABEL[s]}
              </li>
            ))}
          </ol>
        )}

        {video.status === "failed" && (
          <div className="banner error inline">
            <strong>Analysis failed.</strong> {video.error}
            <button className="btn small" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {result?.notice && (
          <div className={`banner inline ${visual ? "info" : "warn"}`}>
            <strong>
              {visual
                ? "Captions from the screen."
                : result.stats.pace === "no_audio"
                  ? "No sound in this video."
                  : "No speech found."}
            </strong>{" "}
            {result.notice}
          </div>
        )}

        <div className="actions">
          {result && (
            <>
              <a className="btn" href={captionsUrl(video.id, "srt")} download>
                Download SRT
              </a>
              <a className="btn" href={captionsUrl(video.id, "vtt")} download>
                Download VTT
              </a>
              <a className="btn" href={captionsUrl(video.id, "txt")} download>
                Download text
              </a>
              <button className="btn" onClick={copyText}>
                {copied ? "Copied!" : "Copy text"}
              </button>
              <button className="btn" onClick={retry} title="Run the analysis again">
                Analyze again
              </button>
            </>
          )}
          <button className="btn danger" onClick={remove}>
            Delete
          </button>
        </div>

        {segments.length > 0 && (
          <ExportCaptions videoId={video.id} language={result?.language ?? video.language} />
        )}
      </div>

      {result && (
        <>
          <div className="stats">
            {visual ? (
              <Stat label="Steps" value={String(segments.length)} note="Read from the screen" />
            ) : (
              <Stat
                label="Speaking speed"
                value={`${Math.round(result.stats.wpm)}`}
                unit="words/min"
                note={PACE_LABEL[result.stats.pace]}
                tone={result.stats.pace}
              />
            )}
            <Stat label="Words" value={result.stats.word_count.toLocaleString()} />
            <Stat
              label="Duration"
              value={formatClock(result.stats.duration_sec * 1000)}
              note={visual ? "No voice" : `${formatClock(result.stats.speaking_sec * 1000)} of speech`}
            />
            <Stat
              label={visual ? "Caption language" : "Language"}
              value={languageName(result.language)}
            />
          </div>

          <div className="card transcript">
            <div className="transcript-head">
              <h2>{visual ? "Steps & captions" : "Transcript & captions"}</h2>
              <input
                type="search"
                placeholder="Search transcript…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {segments.length === 0 ? (
              <p className="muted">No speech was detected in this video.</p>
            ) : (
              <ul>
                {filtered.map((s) => (
                  <li
                    key={s.i}
                    ref={s.i === activeIndex ? activeRow : undefined}
                    className={s.i === activeIndex ? "active" : ""}
                  >
                    <button onClick={() => seek(s.start_ms)}>
                      <span className="time">{formatClock(s.start_ms)}</span>
                      <span className="text">{visual ? `${s.i + 1}. ${s.text}` : s.text}</span>
                      <span className="wpm" title={visual ? "" : "Speaking speed in this caption"}>
                        {visual ? "" : `${Math.round(s.wpm)} wpm`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string; unit?: string; note?: string; tone?: string }) {
  return (
    <div className="card stat">
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">
        {props.value}
        {props.unit && <small> {props.unit}</small>}
      </span>
      {props.note && <span className={`stat-note ${props.tone ?? ""}`}>{props.note}</span>}
    </div>
  );
}
