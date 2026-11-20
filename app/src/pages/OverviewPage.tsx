import { Link } from "react-router";
import { PageHeader } from "@/components/preferences";
import { StatusBadge } from "@/components/status-badge";
import UploadPanel from "@/components/UploadPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEngine } from "@/engine/EngineProvider";
import { useInsights } from "@/engine/useInsights";
import { formatBytes, formatNumber } from "@/format";
import { useI18n } from "@/i18n/I18nProvider";
import { fill } from "@/i18n/text";
import type { Dictionary, Locale } from "@/i18n/types";

function formatSpan(seconds: number, dict: Dictionary, locale: Locale) {
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={dict.overview.title} lead={dict.overview.lead} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={dict.overview.totalVideos} value={videos ? formatNumber(videos.length, locale) : null} />
        <Stat label={dict.overview.minutes} value={videos && (done.length === 0 || loaded) ? formatSpan(seconds, dict, locale) : null} />
        <Stat
          label={dict.overview.avgWpm}
          value={!videos || (done.length > 0 && !loaded) ? null : average === null ? "—" : `${formatNumber(average, locale)} ${dict.detail.wpmUnit}`}
        />
        <Stat label={dict.overview.exports} value={videos && (done.length === 0 || loaded) ? formatNumber(exportsDone, locale) : null} />
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{dict.overview.recent}</CardTitle>
              <Button variant="link" asChild><Link to="/app/videos">{dict.overview.viewAll}</Link></Button>
            </div>
          </CardHeader>
          <CardContent>
            {videos === null ? (
              <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : list.length === 0 ? (
              <div className="py-6 text-center">
                <h3 className="font-heading text-lg">{dict.overview.emptyTitle}</h3>
                <p className="text-sm text-muted-foreground">{dict.overview.emptyBody}</p>
              </div>
            ) : (
              <ul className="grid gap-1">
                {list.slice(0, 5).map((video) => (
                  <li key={video.id}>
                    <Link to={`/app/videos/${video.id}`} className="flex flex-col gap-1 rounded-lg px-2 py-2 hover:bg-muted">
                      <span className="truncate font-medium">{video.filename}</span>
                      <span className="flex items-center justify-between gap-2">
                        <StatusBadge status={video.status} progress={video.progress} />
                        <span className="text-sm text-muted-foreground">{formatBytes(video.size_bytes)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <UploadPanel heading={dict.overview.quickUpload} compact />
          <Card>
            <CardHeader><CardTitle>{dict.overview.engineTitle}</CardTitle></CardHeader>
            <CardContent>
              {health ? (
                <ul className="grid gap-2 text-sm">
                  <EngineRow label={dict.settings.ffmpeg} value={health.ffmpeg ? dict.settings.present : dict.settings.missing} ok={health.ffmpeg} />
                  <EngineRow label={dict.settings.whisper} value={health.whisper ? dict.settings.present : dict.settings.missing} ok={health.whisper} />
                  <EngineRow label={dict.settings.model} value={health.model ? (health.model_name ?? dict.settings.present) : dict.settings.missing} ok={health.model} />
                  <EngineRow label={dict.settings.vision} value={health.vision ? (health.vision_model ?? dict.settings.present) : dict.settings.missing} ok={health.vision} />
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{dict.common.loading}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>{value === null ? <Skeleton className="h-8 w-24" /> : <p className="font-heading text-3xl">{value}</p>}</CardContent>
    </Card>
  );
}

function EngineRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <strong className={ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{value}</strong>
    </li>
  );
}
