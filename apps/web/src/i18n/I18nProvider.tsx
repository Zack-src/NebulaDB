import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import fr from "@/locales/fr.json";
import { loadLocale, saveLocale } from "@/utils/preferences";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  translateWith,
  type DefaultLocale,
  type Locale,
  type TranslateOptions,
  type TranslationKey,
} from "./translate";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, options?: TranslateOptions) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

const FRENCH = fr as Record<string, string>;

type NonDefaultLocale = Exclude<Locale, DefaultLocale>;

/** Non-default locales are fetched on demand — a second dictionary in the initial bundle buys nothing. */
const LOADERS: Record<NonDefaultLocale, () => Promise<Record<string, string>>> = {
  en: () => import("@/locales/en.json").then((module) => module.default as unknown as Record<string, string>),
};

/** One delayed retry after a failed dictionary fetch — long enough to outlast a blip, short enough that the user is probably still on the page. */
const LOCALE_RETRY_MS = 3_000;

/** Falls back to the browser's preference the first time, before any choice is stored. */
function detectInitialLocale(): Locale {
  const stored = loadLocale();
  if (stored) return stored;
  const preferred = navigator.languages?.[0] ?? navigator.language ?? "";
  const base = preferred.split("-")[0];
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  /**
   * Only ever holds a *loaded* non-default dictionary. The French one is a
   * module constant, so it is selected below rather than stored — storing it
   * would mean writing state from the load effect just to put back what was
   * already there, which is a cascading render for no gain.
   */
  const [loaded, setLoaded] = useState<{ locale: Locale; entries: Record<string, string> } | null>(null);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (locale === DEFAULT_LOCALE) return;
    let active = true;
    LOADERS[locale]()
      .then((entries) => {
        // Guards against a fast locale switch resolving out of order and
        // installing the dictionary the user already moved away from.
        if (active) setLoaded({ locale, entries });
      })
      .catch(() => {
        // A dropped connection or a stale chunk hash after a deploy. Without
        // this the rejection was unhandled, `loaded` stayed null, and the app
        // silently sat in French forever with nothing retrying and nothing
        // said. Retry once on the next interaction rather than discarding the
        // user's choice: the stored preference is deliberate, and a reload is
        // what fixes the stale-chunk case.
        if (!active) return;
        window.setTimeout(() => {
          if (!active) return;
          LOADERS[locale]()
            .then((entries) => {
              if (active) setLoaded({ locale, entries });
            })
            .catch(() => {
              /* Still unreachable — French remains the fallback, which is legible. */
            });
        }, LOCALE_RETRY_MS);
      });
    return () => {
      active = false;
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    saveLocale(next);
    setLocaleState(next);
  }, []);

  // Until the requested dictionary has landed, French stands in — a brief
  // frame of French beats a frame of raw translation keys.
  const dictionary = loaded?.locale === locale ? loaded.entries : FRENCH;

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      // French is always the fallback: a key present in fr.json but not yet
      // translated renders in French rather than as a raw key.
      t: (key, options) => translateWith(dictionary, FRENCH, locale, key, options),
    }),
    [dictionary, locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
