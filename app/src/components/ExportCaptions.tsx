import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  exportFileUrl,
  getExport,
  startExport,
  type CaptionExport,
  type ExportMode,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/i18n/I18nProvider";
import { fill } from "@/i18n/text";

function kind(dict: ReturnType<typeof useI18n>["dict"], mode: ExportMode) {
  return mode === "soft" ? dict.captionExport.softKind : dict.captionExport.burnedKind;
}

function statusLine(dict: ReturnType<typeof useI18n>["dict"], job: CaptionExport) {
  const label = kind(dict, job.mode);
  if (job.status === "queued") return fill(dict.captionExport.waiting, { kind: label });
  if (job.status === "rendering") {
    if (job.progress == null) return fill(dict.captionExport.renderingPlain, { kind: label });
    return fill(dict.captionExport.rendering, { kind: label, percent: Math.round(job.progress * 100) });
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
      const message = caught instanceof Error ? caught.message : dict.captionExport.failedFallback;
      setError(message);
      toast.error(message);
      getExport(videoId)
        .then(setJob)
        .catch(() => {});
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || Boolean(running);
  const ready = job?.status === "done" && job.mode === mode;
  const showStatus = job && (job.status !== "done" || job.mode === mode);
  const percent = Math.round((job?.progress ?? 0) * 100);
  const khmer = language.toLowerCase().startsWith("km");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.captionExport.title}</CardTitle>
        <CardDescription>{dict.captionExport.lead}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RadioGroup
          value={mode}
          disabled={busy}
          onValueChange={(value) => {
            setPicked(true);
            setMode(value as ExportMode);
          }}
          aria-label={dict.captionExport.styleLabel}
          className="grid gap-2 sm:grid-cols-2"
        >
          {(["burned", "soft"] as const).map((value) => (
            <Label
              key={value}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 leading-normal has-[[data-state=checked]]:border-primary"
            >
              <RadioGroupItem value={value} />
              {value === "burned" ? dict.captionExport.burned : dict.captionExport.soft}
            </Label>
          ))}
        </RadioGroup>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void start()} disabled={busy}>
            {busy ? dict.captionExport.working : dict.captionExport.action}
          </Button>
          {ready && (
            <Button variant="outline" asChild>
              <a href={exportFileUrl(videoId)} download>
                {dict.captionExport.download}
              </a>
            </Button>
          )}
        </div>
        {running && <Progress value={percent} aria-label={job ? statusLine(dict, job) : dict.captionExport.working} />}
        {showStatus && job && (
          <p className={job.status === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role="status">
            {statusLine(dict, job)}
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {khmer && mode === "burned" && <p className="text-sm text-muted-foreground">{dict.captionExport.khmerFont}</p>}
      </CardContent>
    </Card>
  );
}
