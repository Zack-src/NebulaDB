import en from "@/locales/en.json";
import type { TranslationDictionary } from "./translate";

/**
 * Compile-time parity check between the dictionaries.
 *
 * Nothing imports this module: it exists so `tsc` fails the build when
 * `en.json` is missing a key `fr.json` declares (or declares one `fr.json`
 * doesn't). That makes `npm run build` — which the CI already runs — the
 * translation-completeness gate, with no extra tooling. Because no runtime code
 * imports it, the bundler never pulls `en.json` into the main chunk; the
 * provider still loads it on demand.
 */
const ENGLISH_MATCHES_FRENCH: TranslationDictionary = en;

export type { TranslationDictionary };
export default ENGLISH_MATCHES_FRENCH;
