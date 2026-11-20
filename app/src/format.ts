import type { Locale } from "./i18n/types";

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

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "km" ? "km-KH" : "en").format(value);
}

export function formatWhen(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "km" ? "km-KH" : "en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Same thresholds the engine uses: slow under 110 wpm, fast over 160. */
export function paceFromWpm(wpm: number): "slow" | "normal" | "fast" {
  if (wpm < 110) return "slow";
  if (wpm > 160) return "fast";
  return "normal";
}

export const LANGUAGE_CODES = [
  "auto",
  "en",
  "km",
  "zh",
  "th",
  "vi",
  "ja",
  "ko",
  "fr",
  "es",
  "de",
  "id",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];
