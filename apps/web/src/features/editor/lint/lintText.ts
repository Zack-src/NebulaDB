import type { LintFinding } from "@nebuladb/dbml-engine";
import type { TranslateOptions, TranslationKey } from "@/i18n/translate";

type Translate = (key: TranslationKey, params?: TranslateOptions) => string;
type Wording = Pick<LintFinding, "ruleId" | "params"> & { message?: string };

/** `custom:<id>` — a rule an administrator wrote, whose wording is its own, not a dictionary entry. */
export const isCustomRule = (ruleId: string): boolean => ruleId.startsWith("custom:");

/** The sentence for a finding: the dictionary's for a built-in rule, the administrator's own for a custom one. */
export function lintMessage(t: Translate, finding: Wording): string {
  if (isCustomRule(finding.ruleId)) return finding.message ?? finding.params.label ?? finding.ruleId;
  return t(`lint.rule.${finding.ruleId}.message` as "lint.rule.pk-required.message", finding.params);
}

/** The title of a finding's rule. */
export function lintTitle(t: Translate, finding: Pick<LintFinding, "ruleId" | "params">): string {
  if (isCustomRule(finding.ruleId)) return finding.params.label ?? finding.ruleId.slice("custom:".length);
  return t(`lint.rule.${finding.ruleId}.title` as "lint.rule.pk-required.title");
}
