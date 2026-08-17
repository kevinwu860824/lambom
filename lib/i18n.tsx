"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "zh-TW";

const LOCALE_STORAGE_KEY = "lambom_locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "en" || saved === "zh-TW") setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/**
 * English source text is always the translation key — dictionaries only
 * need to hold the zh-TW side. Each page/component keeps its own dictionary
 * object colocated with its JSX (no shared global dictionary file), so
 * unrelated pages never touch the same file when adding translations.
 */
export function useTranslate(zhDictionary: Record<string, string>): (text: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (text: string) => (locale === "zh-TW" ? (zhDictionary[text] ?? text) : text),
    [locale, zhDictionary]
  );
}
