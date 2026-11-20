import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import type { Status } from "../api";
import { isWorking } from "../engine/status";
import { useI18n } from "../i18n/I18nProvider";
import { statusText } from "../i18n/text";
import { useTheme } from "../theme/ThemeProvider";
import { Icon } from "./Icons";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  const { dict } = useI18n();
  return (
    <Link className="logo" to="/app" aria-label={dict.brand}>
      <img src="/icon.svg" alt="" width={32} height={32} />
      {!compact && (
        <span className="logo-text">
          <strong>{dict.brand}</strong>
          <small>{dict.brandTag}</small>
        </span>
      )}
    </Link>
  );
}

export function HomeLogo() {
  const { dict } = useI18n();
  return (
    <Link className="logo" to="/">
      <img src="/icon.svg" alt="" width={32} height={32} />
      <span className="logo-text">
        <strong>{dict.brand}</strong>
        <small>{dict.brandTag}</small>
      </span>
    </Link>
  );
}

export function LanguageSwitch() {
  const { locale, setLocale, dict } = useI18n();
  return (
    <div className="seg" role="group" aria-label={dict.lang.label}>
      <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
        English
      </button>
      <button type="button" aria-pressed={locale === "km"} onClick={() => setLocale("km")}>
        ភាសាខ្មែរ
      </button>
    </div>
  );
}

export function ThemeToggle() {
  const { resolved, setChoice } = useTheme();
  const { dict } = useI18n();
  const toDark = resolved === "light";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={toDark ? dict.theme.toggleToDark : dict.theme.toggleToLight}
      onClick={() => setChoice(toDark ? "dark" : "light")}
    >
      <Icon name={resolved === "dark" ? "sun" : "moon"} />
    </button>
  );
}

export function StatusChip({ status, progress }: { status: Status; progress: number | null }) {
  const { dict } = useI18n();
  const working = isWorking(status);
  const tone = status === "done" ? "ok" : status === "failed" ? "danger" : "busy";
  return (
    <span className={`chip ${tone}`}>
      {working && <span className="spinner" aria-hidden="true" />}
      {statusText(dict, status, progress)}
    </span>
  );
}

export function CommandText({ template, command }: { template: string; command: string }) {
  const [before, after = ""] = template.split("{command}");
  return (
    <>
      {before}
      <code>{command}</code>
      {after}
    </>
  );
}

export function PageHeader({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {action}
    </header>
  );
}

export function Splash() {
  const { dict } = useI18n();
  return (
    <div className="splash" role="status">
      <img src="/icon.svg" alt="" width={48} height={48} />
      <p>{dict.common.loading}</p>
    </div>
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [...(root?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea") ?? [])];
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !root) return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => onCloseRef.current()}>
      <div
        ref={ref}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return `${[...words[0]][0] ?? ""}${[...words[1]][0] ?? ""}`.toUpperCase();
  }
  return ([...trimmed][0] ?? "?").toUpperCase();
}
