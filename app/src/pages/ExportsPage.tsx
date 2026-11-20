import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getExport, exportFileUrl, type CaptionExport } from "../api";
import { PageHeader } from "../components/Chrome";
import { useEngine } from "../engine/EngineProvider";
import { useI18n } from "../i18n/I18nProvider";

export default function ExportsPage() {
  const { dict } = useI18n();
  const { videos } = useEngine();
  const done = (videos ?? []).filter((video) => video.status === "done");
  const key = done.map((video) => video.id).join("|");
  const [jobs, setJobs] = useState<Record<string, CaptionExport | null>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0) {
      setJobs({});
      setLoaded(true);
      return;
    }
    let alive = true;
    async function load() {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await getExport(id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      if (!alive) return;
      setJobs(Object.fromEntries(entries));
      setLoaded(true);
    }
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [key]);

  return (
    <div className="stack">
      <PageHeader title={dict.captionExport.pageTitle} lead={dict.captionExport.pageLead} />
      {videos === null && <p className="muted">{dict.common.loading}</p>}
      {videos && done.length === 0 && (
        <div className="empty card">
          <h2>{dict.captionExport.emptyTitle}</h2>
          <p>{dict.captionExport.emptyBody}</p>
          <Link className="btn primary" to="/app/upload">
            {dict.library.uploadCta}
          </Link>
        </div>
      )}
      {done.length > 0 && (
        <ul className="export-list">
          {done.map((video) => {
            const job = jobs[video.id];
            const known = loaded || Object.prototype.hasOwnProperty.call(jobs, video.id);
            const percent = job?.progress == null ? null : Math.round(job.progress * 100);
            return (
              <li key={video.id} className="card export-item">
                <div>
                  <h2 className="truncate">{video.filename}</h2>
                  <p className="muted">
                    {!known
                      ? dict.common.loading
                      : job
                        ? job.mode === "soft"
                          ? dict.captionExport.soft
                          : dict.captionExport.burned
                        : dict.captionExport.notYet}
                  </p>
                </div>
                <div className="export-item-side">
                  {job && (
                    <span className={`chip ${job.status === "done" ? "ok" : job.status === "failed" ? "danger" : "busy"}`}>
                      {job.status === "queued" || job.status === "rendering" ? <span className="spinner" aria-hidden="true" /> : null}
                      {job.status === "done"
                        ? dict.status.done
                        : job.status === "failed"
                          ? dict.status.failed
                          : job.status === "queued"
                            ? dict.status.queued
                            : dict.captionExport.working}
                    </span>
                  )}
                  {job && (job.status === "queued" || job.status === "rendering") && (
                    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
                      <div style={{ width: `${percent ?? 0}%` }} />
                    </div>
                  )}
                  {job?.status === "failed" && <p className="field-error">{job.error ?? dict.captionExport.failedFallback}</p>}
                  {job?.status === "done" && (
                    <p className="muted">{dict.captionExport.ready}</p>
                  )}
                  <div className="action-row">
                    <Link className="btn small" to={`/app/videos/${video.id}`}>
                      {dict.captionExport.open}
                    </Link>
                    {job?.status === "done" && (
                      <a className="btn small primary" href={exportFileUrl(video.id)} download>
                        {dict.captionExport.download}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {done.length > 0 && !loaded && <p className="sr-only">{dict.common.loading}</p>}
    </div>
  );
}
