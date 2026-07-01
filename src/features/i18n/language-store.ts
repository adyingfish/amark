// language-store.ts - Current UI language, persisted to localStorage.
import type { Locale } from "./translations";

const LANGUAGE_STORAGE_KEY = "amark-language";

type Listener = () => void;

class LanguageStore {
  private locale: Locale = loadSavedLocale();
  private listeners: Set<Listener> = new Set();

  getLocale(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function loadSavedLocale(): Locale {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh";
}

export const languageStore = new LanguageStore();
document.documentElement.lang = languageStore.getLocale();
