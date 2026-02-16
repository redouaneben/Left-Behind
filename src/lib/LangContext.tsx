"use client";

import { createContext, useContext } from "react";
import { I18N, type LangCode, type I18nStrings } from "./i18n";

interface LangContextValue {
  lang: LangCode;
  t: I18nStrings;
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  t: I18N.en,
});

export function LangProvider({
  lang,
  children,
}: {
  lang: LangCode;
  children: React.ReactNode;
}) {
  const t = I18N[lang] ?? I18N.en;
  return (
    <LangContext.Provider value={{ lang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
