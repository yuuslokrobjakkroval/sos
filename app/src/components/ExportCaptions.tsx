import { useEffect, useState } from "react";
import {
  exportFileUrl,
  getExport,
  startExport,
  type CaptionExport,
  type ExportMode,
} from "../api";

interface Props {
  videoId: string;
  language: string;
}

function kind(mode: ExportMode): string {
  return mode === "soft" ? "soft subtitles" : "burned-in captions";
}

function statusLine(job: CaptionExport): string {
  if (job.status === "queued") return `Waiting to export ${kind(job.mode)}…`;
  if (job.status === "rendering") {
    const pct = job.progress != null ? ` ${Math.round(job.progress * 100)}%` : "";
    return `Exporting ${kind(job.mode)}…${pct}`;
  }
  if (job.status === "failed") return job.error ?? "Export failed.";
  return "Captioned video is ready.";
}

export default function ExportCaptions({ videoId, language }: Props) {
  const [mode, setMode] = useState<ExportMode>("burned");
  const [picked, setPicked] = useState(false);
  const [job, setJob] = useState<CaptionExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    getExport(videoId)
      .then((next) => {
        if (alive) setJob(next);
      })
      .catch(() => {
        if (alive) setJob(null);
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  useEffect(() => {
    if (!picked && job) setMode(job.mode);
  }, [job, picked]);

  const running = job?.status === "queued" || job?.status === "rendering";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      getExport(videoId)
        .then(setJob)
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, videoId]);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      setJob(await startExport(videoId, mode));
    } catch (e) {
      setError((e as Error).message);
      getExport(videoId)
        .then(setJob)
        .catch(() => {});
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || running;
  const ready = job?.status === "done" && job.mode === mode;
  const showStatus = job && (job.status !== "done" || job.mode === mode);

  return (
    <div className="export-panel">
      <h3>Export video with captions</h3>
      <p className="muted">
        Burned-in captions are drawn onto the picture. Soft subtitles are a separate track the
        viewer can turn on or off.
      </p>
      <div className="export-row">
        <select
          aria-label="Caption style"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setPicked(true);
            setMode(e.target.value as ExportMode);
          }}
        >
          <option value="burned">Burned-in</option>
          <option value="soft">Soft subtitles</option>
        </select>
        <button className="btn" onClick={start} disabled={busy}>
          {busy ? "Exporting…" : "Export"}
        </button>
        {ready && (
          <a className="btn" href={exportFileUrl(videoId)} download>
            Download video
          </a>
        )}
      </div>
      {running && (
        <div className="progress">
          <div style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {showStatus && (
        <p className={job?.status === "failed" ? "error-text" : "muted"}>{statusLine(job)}</p>
      )}
      {error && <p className="error-text">{error}</p>}
      {language === "km" && mode === "burned" && (
        <p className="muted">
          Burned-in Khmer text uses Khmer OS Battambang when that font is installed.
        </p>
      )}
    </div>
  );
}
