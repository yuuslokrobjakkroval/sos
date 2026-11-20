import { Link } from "react-router";
import { PageHeader, StatusChip } from "../components/Chrome";
import Thumbnail from "../components/Thumbnail";
import { useEngine } from "../engine/EngineProvider";
import { isWorking } from "../engine/status";
import { formatBytes, formatNumber, formatWhen } from "../format";
import { useI18n } from "../i18n/I18nProvider";
import { fill, languageLabel } from "../i18n/text";

export default function LibraryPage() {
  const { dict, locale } = useI18n();
  const { videos, offline } = useEngine();

  return (
    <div className="stack">
      <PageHeader
        title={dict.library.title}
        lead={videos ? `${dict.library.lead} ${fill(dict.library.count, { count: formatNumber(videos.length, locale) })}` : dict.library.lead}
        action={
          <Link className="btn primary" to="/app/upload">
            {dict.library.uploadCta}
          </Link>
        }
      />
      {videos === null && !offline && (
        <div className="video-grid" aria-hidden="true">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      )}
      {videos === null && offline && <p className="field-error">{dict.detail.loadError}</p>}
      {videos && videos.length === 0 && (
        <div className="empty card">
          <h2>{dict.library.emptyTitle}</h2>
          <p>{dict.library.emptyBody}</p>
          <Link className="btn primary" to="/app/upload">
            {dict.library.uploadCta}
          </Link>
        </div>
      )}
      {videos && videos.length > 0 && (
        <div className="video-grid">
          {videos.map((video) => {
            const percent = video.progress == null ? null : Math.round(video.progress * 100);
            return (
              <Link key={video.id} className="video-card" to={`/app/videos/${video.id}`}>
                <Thumbnail id={video.id} label={video.filename} />
                <div className="video-card-body">
                  <h2>{video.filename}</h2>
                  <div className="meta">
                    <StatusChip status={video.status} progress={video.progress} />
                    <span className="muted">{formatBytes(video.size_bytes)}</span>
                  </div>
                  <p className="muted">
                    {languageLabel(dict, video.language)} · {formatWhen(video.created_at, locale)}
                  </p>
                  {isWorking(video.status) && (
                    <div
                      className={`progress ${percent === null ? "indeterminate" : ""}`}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent ?? undefined}
                    >
                      <div style={percent === null ? undefined : { width: `${percent}%` }} />
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
