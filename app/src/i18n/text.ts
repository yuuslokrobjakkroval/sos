import type { Stats, Status } from "../api";
import { isWorking } from "../engine/status";
import type { Dictionary } from "./types";

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

export function statusText(dict: Dictionary, status: Status, progress: number | null): string {
  const label = dict.status[status];
  if (progress != null && isWorking(status)) {
    return fill(dict.status.withProgress, { label, percent: Math.round(progress * 100) });
  }
  return label;
}

export function languageLabel(dict: Dictionary, code: string | null | undefined): string {
  if (!code) return "—";
  if (Object.prototype.hasOwnProperty.call(dict.languageNames, code)) {
    return dict.languageNames[code as keyof Dictionary["languageNames"]];
  }
  return code.toUpperCase();
}

export function paceLabel(dict: Dictionary, pace: Stats["pace"]): string {
  return dict.pace[pace];
}
