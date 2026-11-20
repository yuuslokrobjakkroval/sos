import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import {
  captionsUrl,
  deleteVideo,
  getVideo,
  mediaUrl,
  retryVideo,
  type Status,
  type Video,
} from "../api";
import { Dialog, PageHeader, StatusChip } from "../components/Chrome";
import ExportCaptions from "../components/ExportCaptions";
import WpmChart from "../components/WpmChart";
import type { ShellContext } from "../components/Shell";
import { useEngine } from "../engine/EngineProvider";
import { isWorking } from "../engine/status";
import { formatClock, formatNumber } from "../format";
import { useI18n } from "../i18n/I18nProvider";
import { fill, languageLabel } from "../i18n/text";

const SPEECH_STEPS: Status[] = ["queued", "extracting_audio", "transcribing", "analyzing"];
const VISUAL_STEPS: Status[] = ["queued", "extracting_audio", "reading_screen"];

export default function VideoDetailPage() {
  const { id = "" } = useParams();
  const { dict, locale } = useI18n();
  const { videos, refresh, removeLocal } = useEngine();
  const { setCrumb } = useOutletContext<ShellContext>();
  const navigate = useNavigate();
  const summary = videos?.find((video) => video.id === id);
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [captionsOn, setCaptionsOn] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const activeRow = useRef<HTMLLIElement>(null);

  useEffect(() => {
    setVideo(null);
    setError(null);
    setCurrentMs(0);
    setQuery("");
  }, [id]);

  useEffect(() => {
    let alive = true;
    setError(null);
    getVideo(id)
      .then((next) => {
        if (alive) setVideo(next);
      })
      .catch((caught) => {
        if (!alive) return;
        const message = caught instanceof Error ? caught.message : "";
        setError(/not found/i.test(message) ? dict.detail.notFound : message || dict.detail.loadError);
      });
    return () => {
      alive = false;
    };
  }, [dict.detail.loadError, dict.detail.notFound, id, summary?.status, summary?.updated_at]);

  useEffect(() => {
    setCrumb(video?.filename ?? null);
    return () => setCrumb(null);
  }, [setCrumb, video?.filename]);

  useEffect(() => {
    if (video?.status !== "done") return;
    let url: string | null = null;
    let alive = true;
    fetch(captionsUrl(video.id, "vtt"))
      .then((response) => response.text())
      .then((text) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        setVttUrl(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setVttUrl(null);
    };
  }, [video?.id, video?.status]);

  const result = video?.result;
  const segments = result?.segments ?? [];
  const activeIndex = segments.findIndex((segment) => currentMs >= segment.start_ms && currentMs < segment.end_ms);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeRow.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeIndex]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return segments
      .map((segment, index) => ({ ...segment, index }))
      .filter((segment) => !needle || segment.text.toLowerCase().includes(needle));
  }, [query, segments]);

  function seek(ms: number) {
    const element = player.current;
    if (!element) return;
    element.currentTime = ms / 1000;
    void element.play().catch(() => {});
  }

  async function remove() {
    if (!video) return;
    await deleteVideo(video.id);
    removeLocal(video.id);
    navigate("/app/videos");
  }

  async function retry() {
    if (!video) return;
    await retryVideo(video.id);
    await refresh();
  }

  async function copyText() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    window.setTimeout(() => setCopied("idle"), 1600);
  }

  if (!video && !error) {
    return (
      <div className="stack" aria-busy="true">
        <span className="skeleton title" />
        <span className="skeleton player" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="empty card">
        <h1>{dict.detail.notFound}</h1>
        <p>{error}</p>
        <Link className="btn" to="/app/videos">
          {dict.detail.back}
        </Link>
      </div>
    );
  }

  const visual = result?.mode === "visual";
  const steps = video.status === "reading_screen" || visual ? VISUAL_STEPS : SPEECH_STEPS;
  const stepIndex = steps.indexOf(video.status);
  const active = activeIndex >= 0 ? segments[activeIndex] : null;
  const noticeTitle = visual
    ? dict.detail.fromScreen
    : result?.stats.pace === "no_audio"
      ? dict.detail.noSound
      : dict.detail.noSpeechFound;

  return (
    <div className="stack detail">
      <Link className="back-link" to="/app/videos">
        {dict.detail.back}
      </Link>
      <PageHeader
        title={video.filename}
        action={
          <span className="meta">
            {result && (
              <span className={`chip ${visual ? "warn" : "ok"}`}>
                {visual ? dict.mode.visual : result.mode === "silent" ? dict.mode.silent : dict.mode.speech}
              </span>
            )}
            <StatusChip status={video.status} progress={video.progress} />
          </span>
        }
      />

      <div className="player-frame">
        <video
          ref={player}
          className="player"
          src={mediaUrl(video.id)}
          controls
          preload="metadata"
          aria-label={dict.detail.playerLabel}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
        >
          {vttUrl && (
            <track kind="subtitles" src={vttUrl} srcLang={result?.language ?? video.language} label={dict.detail.transcript} />
          )}
        </video>
        {captionsOn && active && (
          <div className="caption-overlay" aria-hidden="true">
            {visual ? `${activeIndex + 1}. ${active.text}` : active.text}
          </div>
        )}
        <button
          type="button"
          className="caption-toggle"
          aria-pressed={captionsOn}
          onClick={() => setCaptionsOn((value) => !value)}
        >
          {captionsOn ? dict.detail.captionsOn : dict.detail.captionsOff}
        </button>
      </div>

      {isWorking(video.status) && (
        <ol className="job-steps" aria-label={dict.detail.progressLabel} style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
          {steps.map((step, index) => (
            <li key={step} className={index < stepIndex ? "done" : index === stepIndex ? "current" : ""}>
              {index === stepIndex ? statusLabel(dict, step, video.progress) : dict.status[step]}
            </li>
          ))}
        </ol>
      )}

      {video.status === "failed" && (
        <div className="banner error" role="alert">
          <strong>{dict.detail.failedTitle}</strong> {video.error}
          <button type="button" className="btn small" onClick={() => void retry()}>
            {dict.detail.tryAgain}
          </button>
        </div>
      )}

      {result?.notice && (
        <div className={`banner ${visual ? "info" : "warn"}`} role="status">
          <strong>{noticeTitle}</strong> {result.notice}
        </div>
      )}

      {result && (
        <div className="stat-grid">
          {visual ? (
            <Stat label={dict.detail.steps} value={formatNumber(segments.length, locale)} note={dict.detail.stepsNote} />
          ) : (
            <Stat
              label={dict.detail.speed}
              value={formatNumber(Math.round(result.stats.wpm), locale)}
              unit={dict.detail.wpmUnit}
              note={dict.pace[result.stats.pace]}
              tone={result.stats.pace}
            />
          )}
          <Stat label={dict.detail.words} value={formatNumber(result.stats.word_count, locale)} />
          <Stat
            label={dict.detail.duration}
            value={formatClock(result.stats.duration_sec * 1000)}
            note={visual ? dict.detail.noVoice : fill(dict.detail.speakingOf, { time: formatClock(result.stats.speaking_sec * 1000) })}
          />
          <Stat
            label={visual ? dict.detail.captionLanguage : dict.detail.language}
            value={languageLabel(dict, result.language)}
          />
        </div>
      )}

      <div className="detail-split">
        {result && result.mode === "speech" && segments.length > 0 && (
          <WpmChart segments={segments} activeIndex={activeIndex} onSeek={seek} />
        )}
        <div className="stack">
          <div className="card action-card">
            <div className="action-row">
              {result && (
                <>
                  <a className="btn" href={captionsUrl(video.id, "srt")} download>
                    {dict.detail.downloadSrt}
                  </a>
                  <a className="btn" href={captionsUrl(video.id, "vtt")} download>
                    {dict.detail.downloadVtt}
                  </a>
                  <a className="btn" href={captionsUrl(video.id, "txt")} download>
                    {dict.detail.downloadTxt}
                  </a>
                  <button type="button" className="btn" onClick={() => void copyText()}>
                    {copied === "ok" ? dict.detail.copied : copied === "fail" ? dict.detail.copyFailed : dict.detail.copy}
                  </button>
                  <button type="button" className="btn" onClick={() => void retry()} title={dict.detail.analyzeAgain}>
                    {dict.detail.analyzeAgain}
                  </button>
                </>
              )}
              <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
                {dict.common.delete}
              </button>
            </div>
          </div>
          {segments.length > 0 && (
            <ExportCaptions videoId={video.id} language={result?.language ?? video.language} />
          )}
        </div>
      </div>

      {result && (
        <section className="card transcript">
          <div className="transcript-head">
            <h2>{visual ? dict.detail.stepsTitle : dict.detail.transcript}</h2>
            <label className="sr-only" htmlFor="transcript-search">
              {dict.detail.search}
            </label>
            <input
              id="transcript-search"
              type="search"
              placeholder={dict.detail.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {segments.length === 0 ? (
            <p className="muted">{dict.detail.noSpeech}</p>
          ) : filtered.length === 0 ? (
            <p className="muted">{dict.detail.noMatch}</p>
          ) : (
            <ul>
              {filtered.map((segment) => (
                <li key={segment.index} ref={segment.index === activeIndex ? activeRow : undefined} className={segment.index === activeIndex ? "active" : ""}>
                  <button
                    type="button"
                    onClick={() => seek(segment.start_ms)}
                    aria-current={segment.index === activeIndex ? "true" : undefined}
                  >
                    <span className="time">{formatClock(segment.start_ms)}</span>
                    <span className="text">{visual ? `${segment.index + 1}. ${segment.text}` : segment.text}</span>
                    {!visual && (
                      <span className="wpm" title={dict.detail.lineSpeed}>
                        {fill(dict.detail.lineWpm, { n: formatNumber(Math.round(segment.wpm), locale) })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={confirming} title={dict.detail.deleteTitle} onClose={() => setConfirming(false)}>
        <p>{fill(dict.detail.deleteBody, { name: video.filename })}</p>
        <div className="action-row">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            {dict.common.cancel}
          </button>
          <button type="button" className="btn danger" onClick={() => void remove()}>
            {dict.common.delete}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function statusLabel(dict: ReturnType<typeof useI18n>["dict"], status: Status, progress: number | null) {
  const label = dict.status[status];
  if (progress == null || !isWorking(status)) return label;
  return fill(dict.status.withProgress, { label, percent: Math.round(progress * 100) });
}

function Stat({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: string;
}) {
  return (
    <article className="card stat">
      <span className="stat-label">{label}</span>
      <strong>
        {value}
        {unit && <small> {unit}</small>}
      </strong>
      {note && <span className={`stat-note ${tone ?? ""}`}>{note}</span>}
    </article>
  );
}
