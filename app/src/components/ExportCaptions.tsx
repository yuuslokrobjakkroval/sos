import { useEffect, useState } from "react";
import {
  exportFileUrl,
  getExport,
  startExport,
  type CaptionExport,
  type ExportMode,
} from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";

function kind(dict: ReturnType<typeof useI18n>["dict"], mode: ExportMode): string {
  return mode === "soft" ? dict.captionExport.softKind : dict.captionExport.burnedKind;
}

function statusLine(dict: ReturnType<typeof useI18n>["dict"], job: CaptionExport): string {
  const label = kind(dict, job.mode);
  if (job.status === "queued") return fill(dict.captionExport.waiting, { kind: label });
  if (job.status === "rendering") {
    if (job.progress == null) return fill(dict.captionExport.renderingPlain, { kind: label });
    return fill(dict.captionExport.rendering, {
      kind: label,
      percent: Math.round(job.progress * 100),
    });
  }
  if (job.status === "failed") return job.error ?? dict.captionExport.failedFallback;
  return dict.captionExport.ready;
}

export default function ExportCaptions({ videoId, language }: { videoId: string; language: string }) {
  const { dict } = useI18n();
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : dict.captionExport.failedFallback);
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
  const percent = Math.round((job?.progress ?? 0) * 100);
  const khmer = language.toLowerCase().startsWith("km");

  return (
    <section className="card export-panel">
      <h2>{dict.captionExport.title}</h2>
      <p className="muted">{dict.captionExport.lead}</p>
      <div className="export-row">
        <label className="field grow">
          <span>{dict.captionExport.styleLabel}</span>
          <select
            value={mode}
            disabled={busy}
            onChange={(event) => {
              setPicked(true);
              setMode(event.target.value as ExportMode);
            }}
          >
            <option value="burned">{dict.captionExport.burned}</option>
            <option value="soft">{dict.captionExport.soft}</option>
          </select>
        </label>
        <button type="button" className="btn primary" onClick={() => void start()} disabled={busy}>
          {busy ? dict.captionExport.working : dict.captionExport.action}
        </button>
        {ready && (
          <a className="btn" href={exportFileUrl(videoId)} download>
            {dict.captionExport.download}
          </a>
        )}
      </div>
      {running && (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={job ? statusLine(dict, job) : dict.captionExport.working}
        >
          <div style={{ width: `${percent}%` }} />
        </div>
      )}
      {showStatus && job && (
        <p className={job.status === "failed" ? "field-error" : "muted"} role="status">
          {statusLine(dict, job)}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {khmer && mode === "burned" && <p className="muted">{dict.captionExport.khmerFont}</p>}
    </section>
  );
}
