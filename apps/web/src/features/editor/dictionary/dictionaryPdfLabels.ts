import { completenessPercent, type DataDictionary } from "@nebuladb/dbml-engine";
import { formatDate } from "@/i18n/formatters";
import type { I18nContextValue } from "@/i18n/i18n.svelte";
import type { Locale } from "@/i18n/translate";
import type { DictionaryPdfLabels } from "./dictionaryPdf";

/** The PDF's words in the interface's language — the editor's dictionary and a share link's page write the same document. */
export function dictionaryPdfLabels(
  dictionary: DataDictionary,
  t: I18nContextValue["t"],
  locale: Locale,
): DictionaryPdfLabels {
  const { describedTables, tables, describedColumns, columns } = dictionary.completeness;
  return {
    title: t("dictionary.pdf.title", { name: dictionary.projectName }),
    date: formatDate(new Date(), locale),
    summary: t("dictionary.described", {
      percent: completenessPercent(dictionary),
      tables: `${describedTables}/${tables}`,
      columns: `${describedColumns}/${columns}`,
    }),
    column: t("dictionary.pdf.column"),
    type: t("dictionary.pdf.type"),
    constraints: t("dictionary.pdf.constraints"),
    classification: t("dictionary.pdf.classification"),
    description: t("dictionary.pdf.description"),
    value: t("dictionary.pdf.value"),
    owner: t("dictionary.owner"),
    tags: t("dictionary.pdf.tags"),
    usedBy: t("dictionary.pdf.usedBy"),
    enums: t("dictionary.enums"),
    classes: {
      public: t("dictionary.class.public"),
      internal: t("dictionary.class.internal"),
      personal: t("dictionary.class.personal"),
      sensitive: t("dictionary.class.sensitive"),
    },
  };
}
