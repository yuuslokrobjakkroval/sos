import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { uploadVideo } from "../api";
import { useEngine } from "../engine/EngineProvider";
import { formatBytes, LANGUAGE_CODES, type LanguageCode } from "../format";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../i18n/text";
import { Icon } from "./Icons";

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

export default function UploadPanel({
  heading,
  compact = false,
}: {
  heading?: string;
  compact?: boolean;
}) {
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
  const maxUploadMb = health?.max_upload_mb;

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
    if (maxUploadMb && file.size > maxUploadMb * 1024 * 1024) {
      setError(fill(dict.upload.tooBig, { size: formatBytes(file.size), limit: maxUploadMb }));
      return;
    }
    setCurrent(file);
    setProgress(0);
    try {
      const video = await uploadVideo(file, language, setProgress);
      addVideo(video);
      navigate(`/app/videos/${video.id}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(message.startsWith("Network error") ? dict.upload.network : message);
    } finally {
      setProgress(null);
      setCurrent(null);
      if (input.current) input.current.value = "";
    }
  }

  const percent = Math.round((progress ?? 0) * 100);

  return (
    <section className="card upload-card">
      {heading && <h2>{heading}</h2>}
      <div
        className={`dropzone ${dragging ? "active" : ""} ${uploading ? "busy" : ""}`}
        onClick={() => !uploading && input.current?.click()}
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
        role="button"
        tabIndex={0}
        aria-disabled={uploading}
        aria-busy={uploading}
        onKeyDown={(event) => {
          if (uploading) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
      >
        {uploading ? (
          <>
            <strong className="truncate">{current?.name}</strong>
            <div
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={fill(dict.upload.uploading, { percent })}
            >
              <div style={{ width: `${percent}%` }} />
            </div>
            <span className="muted">{fill(dict.upload.uploading, { percent })}</span>
          </>
        ) : (
          <>
            <span className="drop-icon">
              <Icon name="upload" width={28} height={28} />
            </span>
            <strong>{dict.upload.dropTitle}</strong>
            <span className="muted">
              {maxUploadMb
                ? fill(dict.upload.dropHint, { limit: maxUploadMb })
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

      <label className="field">
        <span>{dict.spokenLanguage}</span>
        <select
          value={language}
          disabled={uploading}
          onChange={(event) => chooseLanguage(event.target.value as LanguageCode)}
        >
          {LANGUAGE_CODES.map((code) => (
            <option key={code} value={code}>
              {dict.languageNames[code]}
            </option>
          ))}
        </select>
      </label>

      {compact ? (
        <p className="muted">{dict.upload.modeShort}</p>
      ) : (
        <div className="mode-block">
          <h3>{dict.upload.modeTitle}</h3>
          <p className="muted">{dict.upload.modeLead}</p>
          <div className="mode-grid">
            <article className="mode-card">
              <span className="chip ok">{dict.mode.always}</span>
              <h4>{dict.mode.speech}</h4>
              <p>{dict.mode.speechBody}</p>
            </article>
            <article className="mode-card">
              <span className={`chip ${health?.vision ? "ok" : "warn"}`}>
                {health?.vision ? dict.mode.visualOn : dict.mode.visualOff}
              </span>
              <h4>{dict.mode.visual}</h4>
              <p>{dict.mode.visualBody}</p>
            </article>
          </div>
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
