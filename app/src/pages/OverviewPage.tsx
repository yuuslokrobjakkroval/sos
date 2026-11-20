import { Link } from "react-router";
import { PageHeader, StatusChip } from "../components/Chrome";
import UploadPanel from "../components/UploadPanel";
import { useEngine } from "../engine/EngineProvider";
import { useInsights } from "../engine/useInsights";
import { formatBytes, formatNumber } from "../format";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";
import type { Dictionary } from "../i18n/types";
import type { Locale } from "../i18n/types";

function formatSpan(seconds: number, dict: Dictionary, locale: Locale): string {
  const minutes = seconds / 60;
  if (minutes < 60) {
    const value = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes);
    return fill(dict.common.minuteValue, { value: formatNumber(value, locale) });
  }
  const hours = minutes / 60;
  const value = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return fill(dict.common.hourValue, { value: formatNumber(value, locale) });
}

export default function OverviewPage() {
  const { dict, locale } = useI18n();
  const { videos, health } = useEngine();
  const { results, exportsDone, loaded } = useInsights(videos);
  const list = videos ?? [];
  const done = list.filter((video) => video.status === "done");
  const speech = done
    .map((video) => results[video.id])
    .filter((result) => result && result.mode === "speech" && result.stats.word_count > 0);
  const seconds = done.reduce((sum, video) => sum + (results[video.id]?.stats.duration_sec ?? 0), 0);
  const average = speech.length
    ? Math.round(speech.reduce((sum, result) => sum + (result?.stats.wpm ?? 0), 0) / speech.length)
    : null;
  const recent = list.slice(0, 5);

  return (
    <div className="stack">
      <PageHeader title={dict.overview.title} lead={dict.overview.lead} />
      <section className="stat-grid" aria-label={dict.overview.title}>
        <Stat label={dict.overview.totalVideos} value={videos ? formatNumber(videos.length, locale) : null} />
        <Stat
          label={dict.overview.minutes}
          value={videos && (done.length === 0 || loaded) ? formatSpan(seconds, dict, locale) : null}
        />
        <Stat
          label={dict.overview.avgWpm}
          value={
            !videos || (done.length > 0 && !loaded)
              ? null
              : average === null
                ? "—"
                : `${formatNumber(average, locale)} ${dict.detail.wpmUnit}`
          }
        />
        <Stat
          label={dict.overview.exports}
          value={videos && (done.length === 0 || loaded) ? formatNumber(exportsDone, locale) : null}
        />
      </section>
      <div className="split">
        <section className="card">
          <div className="section-row">
            <h2>{dict.overview.recent}</h2>
            <Link to="/app/videos">{dict.overview.viewAll}</Link>
          </div>
          {videos === null ? (
            <div className="skeleton-list" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : recent.length === 0 ? (
            <div className="empty compact">
              <h3>{dict.overview.emptyTitle}</h3>
              <p>{dict.overview.emptyBody}</p>
            </div>
          ) : (
            <ul className="recent-list">
              {recent.map((video) => (
                <li key={video.id}>
                  <Link to={`/app/videos/${video.id}`}>
                    <span className="truncate">{video.filename}</span>
                    <span className="meta">
                      <StatusChip status={video.status} progress={video.progress} />
                      <span className="muted">{formatBytes(video.size_bytes)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="stack">
          <UploadPanel heading={dict.overview.quickUpload} compact />
          <section className="card engine-card">
            <h2>{dict.overview.engineTitle}</h2>
            {health ? (
              <ul className="engine-list">
                <li>
                  <span>{dict.settings.ffmpeg}</span>
                  <strong>{health.ffmpeg ? dict.settings.present : dict.settings.missing}</strong>
                </li>
                <li>
                  <span>{dict.settings.whisper}</span>
                  <strong>{health.whisper ? dict.settings.present : dict.settings.missing}</strong>
                </li>
                <li>
                  <span>{dict.settings.model}</span>
                  <strong>{health.model ? (health.model_name ?? dict.settings.present) : dict.settings.missing}</strong>
                </li>
                <li>
                  <span>{dict.settings.vision}</span>
                  <strong>{health.vision ? (health.vision_model ?? dict.settings.present) : dict.settings.missing}</strong>
                </li>
              </ul>
            ) : (
              <p className="muted">{dict.common.loading}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <article className="card stat">
      <span className="stat-label">{label}</span>
      {value === null ? <span className="skeleton" /> : <strong>{value}</strong>}
    </article>
  );
}
