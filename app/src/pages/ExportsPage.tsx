import { useEffect, useState } from "react";
import { Link } from "react-router";
import { exportFileUrl, getExport, type CaptionExport } from "@/api";
import { PageHeader } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useEngine } from "@/engine/EngineProvider";
import { useI18n } from "@/i18n/I18nProvider";

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
    <div className="flex flex-col gap-4">
      <PageHeader title={dict.captionExport.pageTitle} lead={dict.captionExport.pageLead} />
      {videos === null && <p className="text-sm text-muted-foreground">{dict.common.loading}</p>}
      {videos && done.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-10">
            <h2 className="font-heading text-2xl">{dict.captionExport.emptyTitle}</h2>
            <p className="text-muted-foreground">{dict.captionExport.emptyBody}</p>
            <Button asChild><Link to="/app/upload">{dict.library.uploadCta}</Link></Button>
          </CardContent>
        </Card>
      )}
      <ul className="grid gap-3">
        {done.map((video) => {
          const job = jobs[video.id];
          const known = loaded || Object.prototype.hasOwnProperty.call(jobs, video.id);
          const percent = job?.progress == null ? 0 : Math.round(job.progress * 100);
          return (
            <li key={video.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{video.filename}</h2>
                    <p className="text-sm text-muted-foreground">
                      {!known ? dict.common.loading : job ? (job.mode === "soft" ? dict.captionExport.soft : dict.captionExport.burned) : dict.captionExport.notYet}
                    </p>
                  </div>
                  <div className="flex min-w-56 flex-col items-start gap-2 sm:items-end">
                    {job && (
                      <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>
                        {job.status === "done"
                          ? dict.status.done
                          : job.status === "failed"
                            ? dict.status.failed
                            : job.status === "queued"
                              ? dict.status.queued
                              : dict.captionExport.working}
                      </Badge>
                    )}
                    {job && (job.status === "queued" || job.status === "rendering") && <Progress value={percent} className="w-full" />}
                    {job?.status === "failed" && <p className="text-sm text-destructive">{job.error ?? dict.captionExport.failedFallback}</p>}
                    {job?.status === "done" && <p className="text-sm text-muted-foreground">{dict.captionExport.ready}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" asChild><Link to={`/app/videos/${video.id}`}>{dict.captionExport.open}</Link></Button>
                      {job?.status === "done" && (
                        <Button size="sm" asChild><a href={exportFileUrl(video.id)} download>{dict.captionExport.download}</a></Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
