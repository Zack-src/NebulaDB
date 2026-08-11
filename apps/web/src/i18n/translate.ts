import fr from "@/locales/fr.json";

/**
 * The French dictionary is the source of truth for the key set: `en.json` is
 * typed against it, so a key added here and forgotten there is a compile error
 * rather than a string that silently falls back at runtime.
 */
export type TranslationDictionary = typeof fr;

/**
 * Plural entries are stored as `key_one` / `key_other`, but callers name the
 * base key (`t("admin.teams.memberCount", { count })`) and let the locale's
 * plural rule choose the variant — so the base key has to be part of the key
 * type even though no such property exists in the JSON.
 */
type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";
type PluralBaseKey<K> = K extends `${infer Base}${PluralSuffix}` ? Base : never;

export type TranslationKey = keyof TranslationDictionary | PluralBaseKey<keyof TranslationDictionary>;

export const SUPPORTED_LOCALES = ["fr", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE = "fr" satisfies Locale;
export type DefaultLocale = typeof DEFAULT_LOCALE;

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export type InterpolationValues = Record<string, string | number>;

/**
 * Values a message can interpolate. `count` is special: when present it also
 * selects the plural form, so `t("projects.count", { count: n })` reads the
 * `_one` / `_other` variants without the caller writing the branch.
 */
export type TranslateOptions = InterpolationValues & { count?: number };

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Resolves a key against a dictionary.
 *
 * Plural selection uses `Intl.PluralRules` rather than a hand-rolled
 * `count === 1` test: French and English happen to agree on one/other, but the
 * rule belongs to the locale, not to the call site, and this keeps a third
 * locale from having to change every plural string.
 */
export function translateWith(
  dictionary: Record<string, string>,
  fallback: Record<string, string>,
  locale: Locale,
  key: string,
  options?: TranslateOptions,
): string {
  const lookup = (candidate: string): string | undefined => dictionary[candidate] ?? fallback[candidate];

  let template: string | undefined;
  if (options?.count !== undefined) {
    const category = new Intl.PluralRules(locale).select(options.count);
    template = lookup(`${key}_${category}`);
  }
  // `_other` last: it covers both a missing plural category and a plural key
  // used without a count.
  template ??= lookup(key) ?? lookup(`${key}_other`);

  // A missing key renders as the key itself: visible in the UI and greppable,
  // rather than an empty element nobody notices.
  if (template === undefined) return key;
  return options ? interpolate(template, options) : template;
}
