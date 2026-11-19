import type { Status, Stats } from "./api";

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const STATUS_LABEL: Record<Status, string> = {
  queued: "Queued",
  extracting_audio: "Extracting audio",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  reading_screen: "Reading screen",
  done: "Done",
  failed: "Failed",
};

export const isWorking = (s: Status) => s !== "done" && s !== "failed";

/** "Reading screen 45%" while progress is known. */
export function statusText(status: Status, progress: number | null): string {
  const label = STATUS_LABEL[status];
  return progress != null && isWorking(status) ? `${label} ${Math.round(progress * 100)}%` : label;
}

export const PACE_LABEL: Record<Stats["pace"], string> = {
  slow: "Slow",
  normal: "Normal",
  fast: "Fast",
  no_speech: "No speech",
  no_audio: "No sound",
};

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "km", name: "Khmer" },
  { code: "zh", name: "Chinese" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "id", name: "Indonesian" },
];

export function languageName(code: string | null | undefined): string {
  if (!code) return "—";
  return LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}
