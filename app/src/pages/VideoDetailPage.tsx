import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  captionsUrl,
  deleteVideo,
  getVideo,
  mediaUrl,
  retryVideo,
  type Status,
  type Video,
} from "@/api";
import ExportCaptions from "@/components/ExportCaptions";
import { useShell } from "@/components/Shell";
import { StatusBadge } from "@/components/status-badge";
import WpmChart from "@/components/WpmChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isWorking } from "@/engine/status";
import { useEngine } from "@/engine/EngineProvider";
import { formatClock, formatNumber } from "@/format";
import { useI18n } from "@/i18n/I18nProvider";
import { fill, languageLabel, statusText } from "@/i18n/text";

const SPEECH_STEPS: Status[] = ["queued", "extracting_audio", "transcribing", "analyzing"];
const VISUAL_STEPS: Status[] = ["queued", "extracting_audio", "reading_screen"];

export default function VideoDetailPage() {
  const { id = "" } = useParams();
  const { dict, locale } = useI18n();
  const { videos, refresh, removeLocal } = useEngine();
  const { setCrumb } = useShell();
  const navigate = useNavigate();
  const summary = videos?.find((video) => video.id === id);
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [query, setQuery] = useState("");
  const [captionsOn, setCaptionsOn] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setVideo(null);
    setError(null);
    setCurrentMs(0);
    setQuery("");
  }, [id]);

  useEffect(() => {
    let alive = true;
    getVideo(id)
      .then((next) => {
        if (alive) setVideo(next);
      })
      .catch((caught) => {
        if (!alive) return;
        const message = caught instanceof Error ? caught.message : "";
        setError(/not found/i.test(message) ? dict.detail.notFound : message || dict.detail.loadError);
      });
    return () => {
      alive = false;
    };
  }, [dict.detail.loadError, dict.detail.notFound, id, summary?.status, summary?.updated_at]);

  useEffect(() => {
    setCrumb(video?.filename ?? null);
    return () => setCrumb(null);
  }, [setCrumb, video?.filename]);

  useEffect(() => {
    if (video?.status !== "done") return;
    let url: string | null = null;
    let alive = true;
    fetch(captionsUrl(video.id, "vtt"))
      .then((response) => response.text())
      .then((text) => {
        if (!alive) return;
        url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        setVttUrl(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setVttUrl(null);
    };
  }, [video?.id, video?.status]);

  const result = video?.result;
  const segments = result?.segments ?? [];
  const activeIndex = segments.findIndex((segment) => currentMs >= segment.start_ms && currentMs < segment.end_ms);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeRow.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeIndex]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return segments
      .map((segment, index) => ({ ...segment, index }))
      .filter((segment) => !needle || segment.text.toLowerCase().includes(needle));
  }, [query, segments]);

  function seek(ms: number) {
    const element = player.current;
    if (!element) return;
    element.currentTime = ms / 1000;
    void element.play().catch(() => {});
  }

  if (!video && !error) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (!video) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-10">
          <h1 className="font-heading text-2xl">{dict.detail.notFound}</h1>
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" asChild><Link to="/app/videos">{dict.detail.back}</Link></Button>
        </CardContent>
      </Card>
    );
  }

  const visual = result?.mode === "visual";
  const steps = video.status === "reading_screen" || visual ? VISUAL_STEPS : SPEECH_STEPS;
  const stepIndex = steps.indexOf(video.status);
  const active = activeIndex >= 0 ? segments[activeIndex] : null;
  const noticeTitle = visual
    ? dict.detail.fromScreen
    : result?.stats.pace === "no_audio"
      ? dict.detail.noSound
      : dict.detail.noSpeechFound;

  return (
    <div className="flex flex-col gap-4">
      <Button variant="link" className="w-fit px-0" asChild>
        <Link to="/app/videos">{dict.detail.back}</Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-heading text-2xl leading-snug wrap-break-word">{video.filename}</h1>
        <div className="flex flex-wrap gap-2">
          {result && (
            <Badge variant="secondary">
              {visual ? dict.mode.visual : result.mode === "silent" ? dict.mode.silent : dict.mode.speech}
            </Badge>
          )}
          <StatusBadge status={video.status} progress={video.progress} />
        </div>
      </div>
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={player}
          className="max-h-[68vh] w-full"
          src={mediaUrl(video.id)}
          controls
          preload="metadata"
          aria-label={dict.detail.playerLabel}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
        >
          {vttUrl && <track kind="subtitles" src={vttUrl} srcLang={result?.language ?? video.language} label={dict.detail.transcript} />}
        </video>
        {captionsOn && active && (
          <div className="pointer-events-none absolute inset-x-[6%] bottom-16 rounded-lg bg-black/75 px-3 py-2 text-center text-base leading-relaxed text-white">
            {visual ? `${activeIndex + 1}. ${active.text}` : active.text}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute top-3 right-3"
          aria-pressed={captionsOn}
          onClick={() => setCaptionsOn((value) => !value)}
        >
          {captionsOn ? dict.detail.captionsOn : dict.detail.captionsOff}
        </Button>
      </div>
      {isWorking(video.status) && (
        <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={dict.detail.progressLabel}>
          {steps.map((step, index) => (
            <li key={step} className={`border-t-2 pt-2 text-sm ${index < stepIndex ? "border-emerald-600" : index === stepIndex ? "border-primary font-semibold text-primary" : "border-border text-muted-foreground"}`}>
              {index === stepIndex ? statusText(dict, step, video.progress) : dict.status[step]}
            </li>
          ))}
        </ol>
      )}
      {video.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <strong>{dict.detail.failedTitle}</strong> {video.error}
          <Button size="sm" variant="outline" onClick={() => void retryVideo(video.id).then(() => refresh())}>{dict.detail.tryAgain}</Button>
        </div>
      )}
      {result?.notice && (
        <div className="rounded-lg bg-muted px-3 py-2 text-sm" role="status">
          <strong>{noticeTitle}</strong> {result.notice}
        </div>
      )}
      <Tabs defaultValue="transcript">
        <TabsList className="flex h-auto w-full flex-wrap">
          <TabsTrigger value="transcript">{visual ? dict.detail.stepsTitle : dict.detail.transcript}</TabsTrigger>
          <TabsTrigger value="captions">{dict.home.features[1]?.title}</TabsTrigger>
          <TabsTrigger value="analysis">{dict.detail.speed}</TabsTrigger>
          <TabsTrigger value="export">{dict.captionExport.action}</TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="mt-3">
          <Card>
            <CardContent className="grid gap-3 pt-4">
              <Input
                type="search"
                value={query}
                placeholder={dict.detail.search}
                aria-label={dict.detail.search}
                onChange={(event) => setQuery(event.target.value)}
              />
              {segments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{dict.detail.noSpeech}</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">{dict.detail.noMatch}</p>
              ) : (
                <ScrollArea className="h-[28rem] pr-3">
                  <ul className="grid">
                    {filtered.map((segment) => (
                      <li key={segment.index}>
                        <button
                          type="button"
                          ref={segment.index === activeIndex ? activeRow : undefined}
                          aria-current={segment.index === activeIndex ? "true" : undefined}
                          className={`grid w-full grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-lg border-l-2 px-3 py-2 text-left leading-relaxed sm:grid-cols-[4rem_minmax(0,1fr)_auto] ${
                            segment.index === activeIndex ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
                          }`}
                          onClick={() => seek(segment.start_ms)}
                        >
                          <span className="text-primary tabular-nums">{formatClock(segment.start_ms)}</span>
                          <span>{visual ? `${segment.index + 1}. ${segment.text}` : segment.text}</span>
                          {!visual && (
                            <span className="text-sm text-muted-foreground" title={dict.detail.lineSpeed}>
                              {fill(dict.detail.lineWpm, { n: formatNumber(Math.round(segment.wpm), locale) })}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="captions" className="mt-3">
          <Card>
            <CardContent className="flex flex-wrap gap-2 pt-4">
              {result ? (
                <>
                  <Button variant="outline" asChild><a href={captionsUrl(video.id, "srt")} download>{dict.detail.downloadSrt}</a></Button>
                  <Button variant="outline" asChild><a href={captionsUrl(video.id, "vtt")} download>{dict.detail.downloadVtt}</a></Button>
                  <Button variant="outline" asChild><a href={captionsUrl(video.id, "txt")} download>{dict.detail.downloadTxt}</a></Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.text).then(
                        () => toast.success(dict.detail.copied),
                        () => toast.error(dict.detail.copyFailed),
                      );
                    }}
                  >
                    {dict.detail.copy}
                  </Button>
                  <Button variant="outline" onClick={() => void retryVideo(video.id).then(() => refresh())}>{dict.detail.analyzeAgain}</Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{dict.common.loading}</p>
              )}
              <Button variant="destructive" className="ml-auto" onClick={() => setConfirming(true)}>{dict.common.delete}</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="analysis" className="mt-3 grid gap-3">
          {result && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {visual ? (
                <Stat label={dict.detail.steps} value={formatNumber(segments.length, locale)} note={dict.detail.stepsNote} />
              ) : (
                <Stat label={dict.detail.speed} value={`${formatNumber(Math.round(result.stats.wpm), locale)} ${dict.detail.wpmUnit}`} note={dict.pace[result.stats.pace]} />
              )}
              <Stat label={dict.detail.words} value={formatNumber(result.stats.word_count, locale)} />
              <Stat
                label={dict.detail.duration}
                value={formatClock(result.stats.duration_sec * 1000)}
                note={visual ? dict.detail.noVoice : fill(dict.detail.speakingOf, { time: formatClock(result.stats.speaking_sec * 1000) })}
              />
              <Stat label={visual ? dict.detail.captionLanguage : dict.detail.language} value={languageLabel(dict, result.language)} />
            </div>
          )}
          {result && result.mode === "speech" && segments.length > 0 && (
            <WpmChart segments={segments} activeIndex={activeIndex} onSeek={seek} />
          )}
        </TabsContent>
        <TabsContent value="export" className="mt-3">
          {segments.length > 0 ? (
            <ExportCaptions videoId={video.id} language={result?.language ?? video.language} />
          ) : (
            <p className="text-sm text-muted-foreground">{dict.captionExport.emptyBody}</p>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.detail.deleteTitle}</DialogTitle>
            <DialogDescription>{fill(dict.detail.deleteBody, { name: video.filename })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>{dict.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                void deleteVideo(video.id).then(() => {
                  removeLocal(video.id);
                  toast.success(dict.common.delete);
                  navigate("/app/videos");
                });
              }}
            >
              {dict.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="grid gap-1 pt-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <strong className="font-heading text-2xl leading-snug">{value}</strong>
        {note && <span className="text-sm text-muted-foreground">{note}</span>}
      </CardContent>
    </Card>
  );
}
