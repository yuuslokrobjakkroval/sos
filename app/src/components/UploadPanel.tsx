import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Upload01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { uploadVideo } from "@/api";
import { AppIcon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEngine } from "@/engine/EngineProvider";
import { formatBytes, LANGUAGE_CODES, type LanguageCode } from "@/format";
import { useI18n } from "@/i18n/I18nProvider";
import { fill } from "@/i18n/text";

const LANGUAGE_KEY = "automate.uploadLanguage";

function readLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && (LANGUAGE_CODES as readonly string[]).includes(saved)) return saved as LanguageCode;
  } catch {
    /* ignore */
  }
  return "auto";
}

export default function UploadPanel({ heading, compact = false }: { heading?: string; compact?: boolean }) {
  const { dict } = useI18n();
  const { health, addVideo } = useEngine();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<LanguageCode>(readLanguage);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;
  const percent = Math.round((progress ?? 0) * 100);

  function chooseLanguage(next: LanguageCode) {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  async function upload(file: File) {
    setError(null);
    if (health?.max_upload_mb && file.size > health.max_upload_mb * 1024 * 1024) {
      const message = fill(dict.upload.tooBig, { size: formatBytes(file.size), limit: health.max_upload_mb });
      setError(message);
      toast.error(message);
      return;
    }
    setCurrent(file);
    setProgress(0);
    try {
      const video = await uploadVideo(file, language, setProgress);
      addVideo(video);
      toast.success(video.filename);
      navigate(`/app/videos/${video.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      const text = message.startsWith("Network error") ? dict.upload.network : message;
      setError(text);
      toast.error(text);
    } finally {
      setProgress(null);
      setCurrent(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card>
      {heading && (
        <CardHeader>
          <CardTitle>{heading}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-4">
        <div
          role="button"
          tabIndex={0}
          aria-disabled={uploading}
          aria-busy={uploading}
          className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center ${
            dragging ? "border-primary bg-primary/10" : "border-input bg-muted/40"
          } ${uploading ? "cursor-progress" : ""}`}
          onClick={() => !uploading && input.current?.click()}
          onKeyDown={(event) => {
            if (uploading) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file && !uploading) void upload(file);
          }}
        >
          {uploading ? (
            <>
              <strong className="max-w-full truncate">{current?.name}</strong>
              <Progress value={percent} className="w-full max-w-xs" aria-label={fill(dict.upload.uploading, { percent })} />
              <span className="text-sm text-muted-foreground">{fill(dict.upload.uploading, { percent })}</span>
            </>
          ) : (
            <>
              <span className="grid size-12 place-items-center rounded-xl bg-background text-primary">
                <AppIcon icon={Upload01Icon} size={22} />
              </span>
              <strong>{dict.upload.dropTitle}</strong>
              <span className="text-sm text-muted-foreground">
                {health?.max_upload_mb
                  ? fill(dict.upload.dropHint, { limit: health.max_upload_mb })
                  : dict.upload.dropHintNoLimit}
              </span>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept="video/*,audio/*,.mkv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label>{dict.spokenLanguage}</Label>
          <Select value={language} disabled={uploading} onValueChange={(value) => chooseLanguage(value as LanguageCode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {dict.languageNames[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {compact ? (
          <p className="text-sm text-muted-foreground">{dict.upload.modeShort}</p>
        ) : (
          <div className="grid gap-3">
            <div>
              <h3 className="font-heading text-lg">{dict.upload.modeTitle}</h3>
              <p className="text-sm text-muted-foreground">{dict.upload.modeLead}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <article className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
                <Badge variant="secondary">{dict.mode.always}</Badge>
                <h4 className="font-medium">{dict.mode.speech}</h4>
                <p className="text-sm text-muted-foreground">{dict.mode.speechBody}</p>
              </article>
              <article className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
                <Badge variant={health?.vision ? "secondary" : "outline"}>
                  {health?.vision ? dict.mode.visualOn : dict.mode.visualOff}
                </Badge>
                <h4 className="font-medium">{dict.mode.visual}</h4>
                <p className="text-sm text-muted-foreground">{dict.mode.visualBody}</p>
              </article>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
