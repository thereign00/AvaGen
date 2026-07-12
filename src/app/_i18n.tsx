"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * English-only i18n provider.
 * All tr(fr, en) calls throughout the app automatically return the English string.
 */

export type Lang = "en";

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    try {
      localStorage.setItem("lang", "en");
      document.documentElement.setAttribute("lang", "en");
    } catch {}
  }, []);

  return <LangCtx.Provider value={{ lang: "en", setLang: () => {} }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

/** Always returns the English text: `tr(fr, en)` -> en */
export function useT(): (fr: string, en: string) => string {
  return (_fr: string, en: string) => en;
}
