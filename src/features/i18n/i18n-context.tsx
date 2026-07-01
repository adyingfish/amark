// i18n-context.tsx - React binding for the language store.
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { languageStore } from "./language-store";
import { type Locale, type TranslationKey, translate } from "./translations";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => languageStore.getLocale());

  useEffect(() => languageStore.subscribe(() => setLocaleState(languageStore.getLocale())), []);

  const value: I18nContextValue = {
    locale,
    setLocale: (next) => languageStore.setLocale(next),
    t: (key) => translate(key, locale),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** For non-React modules (e.g. dialog.ts) that need the current translation at call time. */
export function t(key: TranslationKey): string {
  return translate(key, languageStore.getLocale());
}
