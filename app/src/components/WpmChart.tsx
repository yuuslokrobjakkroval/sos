import type { Segment } from "../api";
import { formatClock, formatNumber, paceFromWpm } from "../format";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";

export default function WpmChart({
  segments,
  activeIndex,
  onSeek,
}: {
  segments: Segment[];
  activeIndex: number;
  onSeek: (ms: number) => void;
}) {
  const { dict, locale } = useI18n();
  const max = Math.max(200, ...segments.map((segment) => segment.wpm));
  return (
    <section className="card chart-card">
      <div className="chart-head">
        <h2>{dict.detail.chartTitle}</h2>
        <p className="muted">{dict.detail.chartHint}</p>
      </div>
      <div className="chart-scroll">
        <div className="chart" style={{ minWidth: Math.max(240, segments.length * 16) }}>
          <div className="chart-guides" aria-hidden="true">
            <span style={{ bottom: `${(160 / max) * 100}%` }}>{formatNumber(160, locale)}</span>
            <span style={{ bottom: `${(110 / max) * 100}%` }}>{formatNumber(110, locale)}</span>
          </div>
          <div className="chart-bars" role="list">
            {segments.map((segment, index) => {
              const pace = paceFromWpm(segment.wpm);
              const height = Math.max(6, (segment.wpm / max) * 100);
              return (
                <button
                  key={`${segment.start_ms}-${index}`}
                  type="button"
                  role="listitem"
                  className={`chart-bar pace-${pace} ${index === activeIndex ? "active" : ""}`}
                  style={{ height: `${height}%` }}
                  aria-current={index === activeIndex ? "true" : undefined}
                  aria-label={fill(dict.detail.chartBar, {
                    time: formatClock(segment.start_ms),
                    wpm: formatNumber(Math.round(segment.wpm), locale),
                    pace: dict.pace[pace],
                  })}
                  onClick={() => onSeek(segment.start_ms)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
