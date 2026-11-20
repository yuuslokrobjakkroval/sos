import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/preferences";
import { StatusBadge } from "@/components/status-badge";
import Thumbnail from "@/components/Thumbnail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEngine } from "@/engine/EngineProvider";
import { isWorking } from "@/engine/status";
import { formatBytes, formatNumber, formatWhen } from "@/format";
import { useI18n } from "@/i18n/I18nProvider";
import { fill, languageLabel } from "@/i18n/text";

type Filter = "all" | "working" | "done" | "failed";

export default function LibraryPage() {
  const { dict, locale } = useI18n();
  const { videos, offline } = useEngine();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    if (!videos) return [];
    if (filter === "working") return videos.filter((video) => isWorking(video.status));
    if (filter === "done" || filter === "failed") return videos.filter((video) => video.status === filter);
    return videos;
  }, [filter, videos]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={dict.library.title}
        lead={videos ? `${dict.library.lead} ${fill(dict.library.count, { count: formatNumber(videos.length, locale) })}` : dict.library.lead}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <SelectTrigger className="w-40" aria-label={dict.common.search}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{dict.library.title}</SelectItem>
                <SelectItem value="working">{dict.status.transcribing}</SelectItem>
                <SelectItem value="done">{dict.status.done}</SelectItem>
                <SelectItem value="failed">{dict.status.failed}</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild><Link to="/app/upload">{dict.library.uploadCta}</Link></Button>
          </div>
        }
      />
      {videos === null && !offline && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" />
        </div>
      )}
      {videos === null && offline && <p className="text-sm text-destructive">{dict.detail.loadError}</p>}
      {videos && shown.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <h2 className="font-heading text-2xl">{dict.library.emptyTitle}</h2>
            <p className="max-w-md text-muted-foreground">{dict.library.emptyBody}</p>
            <Button asChild><Link to="/app/upload">{dict.library.uploadCta}</Link></Button>
          </CardContent>
        </Card>
      )}
      {shown.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((video) => (
            <Link key={video.id} to={`/app/videos/${video.id}`} className="overflow-hidden rounded-xl border bg-card text-inherit no-underline hover:border-primary">
              <Thumbnail id={video.id} label={video.filename} />
              <div className="flex flex-col gap-2 p-3">
                <h2 className="line-clamp-2 font-medium leading-snug">{video.filename}</h2>
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={video.status} progress={video.progress} />
                  <span className="text-sm text-muted-foreground">{formatBytes(video.size_bytes)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {languageLabel(dict, video.language)} · {formatWhen(video.created_at, locale)}
                </p>
                {isWorking(video.status) && <Progress value={video.progress == null ? 15 : Math.round(video.progress * 100)} />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
