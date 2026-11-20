import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { km } from "./km";
import type { Dictionary, Locale } from "./types";

const LOCALE_KEY = "automate.locale";

interface I18nValue {
  locale: Locale;
  dict: Dictionary;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === "en" || saved === "km") return saved;
  } catch {
    /* private mode */
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);
  const dict = locale === "km" ? km : en;

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dict.metaTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", dict.metaDescription);
  }, [dict, locale]);

  const value = useMemo(() => ({ locale, dict, setLocale }), [locale, dict]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
