import type { Contribution, InvokeResult } from "@/features/plugins/types";
import type { BuiltinPlugin, BuiltinRunner } from "./types";

const contributions: Contribution[] = [
  {
    kind: "editorCommand",
    id: "sort-tables-alphabetically",
    label: "Trier les blocs Tables par ordre alphabétique",
    shortcut: "Ctrl+Alt+T",
    description: "Réorganise tous les blocs Table {...} du code DBML par nom alphabétique.",
  },
  {
    kind: "editorCommand",
    id: "add-timestamps-dbml",
    label: "Insérer created_at/updated_at dans les tables",
    description: "Insère les colonnes created_at timestamp et updated_at timestamp dans chaque table du DBML.",
  },
];

const runners: Record<string, BuiltinRunner> = {
  "editorCommand:sort-tables-alphabetically": (input) => {
    const { text } = (input as { text: string }) || { text: "" };
    const tableRegex = /Table\s+([A-Za-z0-9_".]+)(?:(?:\s+as\s+[A-Za-z0-9_]+)?)?\s*\{[\s\S]*?\}/gi;
    const tables: { name: string; block: string }[] = [];

    let match: RegExpExecArray | null;
    while ((match = tableRegex.exec(text)) !== null) {
      const rawName = match[1].replace(/["`]/g, "");
      tables.push({ name: rawName, block: match[0] });
    }

    if (tables.length <= 1) {
      return { message: "Rien à trier ou une seule table trouvée." };
    }

    const nonTableText = text.replace(tableRegex, "___TABLE_PLACEHOLDER___");
    tables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    let sortedIndex = 0;
    const sortedDbml = nonTableText.replace(/___TABLE_PLACEHOLDER___/g, () => {
      const block = tables[sortedIndex]?.block || "";
      sortedIndex++;
      return block;
    });

    return {
      text: sortedDbml,
      message: `${tables.length} tables triées par ordre alphabétique.`,
    };
  },

  "editorCommand:add-timestamps-dbml": (input) => {
    const { text } = (input as { text: string }) || { text: "" };
    let modifiedCount = 0;

    const updated = text.replace(/Table\s+([A-Za-z0-9_".]+)[^{]*\{([\s\S]*?)\}/gi, (match, _tableName, body) => {
      const hasCreated = /created_at\s+/i.test(body);
      const hasUpdated = /updated_at\s+/i.test(body);

      if (hasCreated && hasUpdated) return match;

      let addition = "";
      if (!hasCreated) addition += "\n  created_at timestamp [not null, default: `now()`]";
      if (!hasUpdated) addition += "\n  updated_at timestamp [not null, default: `now()`]";

      modifiedCount++;
      return match.replace(/\}$/, `${addition}\n}`);
    });

    return {
      text: updated,
      message: `Timestamps ajoutés dans ${modifiedCount} table(s).`,
    };
  },
};

export const coreEditorPlugin: BuiltinPlugin = {
  manifest: {
    id: "athanordb.core-editor",
    name: "Commandes Éditeur DBML",
    version: "1.0.0",
    author: "AthanorDB",
    category: "editor",
    description: "Améliorations de l'éditeur DBML : tri alphabétique des tables et injection de code.",
    tags: ["editor", "dbml", "sort", "format"],
  },
  contributions,
  run: async (kind, id, input, ctx) => {
    const runner = runners[`${kind}:${id}`];
    if (!runner) throw new Error(`Unknown contribution ${kind}:${id}`);
    return (await runner(input, ctx)) as InvokeResult;
  },
};
