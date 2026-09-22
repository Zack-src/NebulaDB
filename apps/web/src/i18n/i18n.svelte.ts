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
  readonly locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, options?: TranslateOptions) => string;
}

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

/**
 * The app's one translation state, shared by every component.
 *
 * A module-level rune object rather than a context provider: there is exactly
 * one locale per tab, and `t()` reading `dictionary` (a `$derived`) is what
 * makes every `{t("…")}` in a template re-render on a locale switch — and
 * only those expressions, nothing else around them.
 */
class I18nState implements I18nContextValue {
  locale = $state<Locale>(detectInitialLocale());
  /**
   * Only ever holds a *loaded* non-default dictionary. The French one is a
   * module constant, so it is selected below rather than stored.
   */
  private loaded = $state.raw<{ locale: Locale; entries: Record<string, string> } | null>(null);

  // Until the requested dictionary has landed, French stands in — a brief
  // frame of French beats a frame of raw translation keys.
  private dictionary = $derived(this.loaded?.locale === this.locale ? this.loaded.entries : FRENCH);

  setLocale = (next: Locale): void => {
    saveLocale(next);
    this.locale = next;
  };

  // French is always the fallback: a key present in fr.json but not yet
  // translated renders in French rather than as a raw key.
  t = (key: TranslationKey, options?: TranslateOptions): string =>
    translateWith(this.dictionary, FRENCH, this.locale, key, options);

  /** Installs the side effects (document `lang`, on-demand dictionary loading). Call once from the root component. */
  install(): void {
    $effect(() => {
      document.documentElement.lang = this.locale;
    });

    $effect(() => {
      const locale = this.locale;
      if (locale === DEFAULT_LOCALE) return;
      let active = true;
      LOADERS[locale]()
        .then((entries) => {
          // Guards against a fast locale switch resolving out of order and
          // installing the dictionary the user already moved away from.
          if (active) this.loaded = { locale, entries };
        })
        .catch(() => {
          // A dropped connection or a stale chunk hash after a deploy. Retry
          // once rather than discarding the user's choice: the stored
          // preference is deliberate, and a reload is what fixes the
          // stale-chunk case.
          if (!active) return;
          window.setTimeout(() => {
            if (!active) return;
            LOADERS[locale]()
              .then((entries) => {
                if (active) this.loaded = { locale, entries };
              })
              .catch(() => {
                /* Still unreachable — French remains the fallback, which is legible. */
              });
          }, LOCALE_RETRY_MS);
        });
      return () => {
        active = false;
      };
    });
  }
}

export const i18n = new I18nState();

/** Same shape the components always used — `const { t } = useTranslation()`. `locale` stays reactive (a getter on the shared state). */
export function useTranslation(): I18nContextValue {
  return i18n;
}
