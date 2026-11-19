import { useRef, useState } from "react";
import { uploadVideo, type Video } from "../api";
import { formatBytes, LANGUAGES } from "../format";

interface Props {
  maxUploadMb?: number;
  onUploaded: (video: Video) => void;
}

export default function UploadCard({ maxUploadMb, onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState("auto");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (maxUploadMb && file.size > maxUploadMb * 1024 * 1024) {
      setError(`File is ${formatBytes(file.size)} — the limit is ${maxUploadMb} MB.`);
      return;
    }
    setCurrent(file);
    setProgress(0);
    try {
      const video = await uploadVideo(file, language, setProgress);
      onUploaded(video);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
      setCurrent(null);
      if (input.current) input.current.value = "";
    }
  }

  const uploading = progress !== null;

  return (
    <div className="card upload">
      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${uploading ? "disabled" : ""}`}
        onClick={() => !uploading && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !uploading) upload(file);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) input.current?.click();
        }}
      >
        {uploading ? (
          <>
            <strong className="truncate">{current?.name}</strong>
            <div className="progress">
              <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <span className="muted">Uploading… {Math.round((progress ?? 0) * 100)}%</span>
          </>
        ) : (
          <>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <strong>Drop a video here or click to choose</strong>
            <span className="muted">
              MP4, MOV, MKV, WEBM, MP3…{maxUploadMb ? ` up to ${maxUploadMb} MB` : ""}
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="video/*,audio/*,.mkv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
      </div>

      <label className="field">
        <span>Spoken language</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={uploading}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
