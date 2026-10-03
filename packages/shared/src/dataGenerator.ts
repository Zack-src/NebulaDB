import type { Field, Ref, Table } from "./schema.js";

/**
 * Test data, generated from the schema alone — never from real rows. Pure and
 * seeded: the same configuration and seed give the same rows, on the server
 * and in the editor.
 */

export type GeneratorLocale = "fr" | "en";
export const GENERATOR_LOCALES: readonly GeneratorLocale[] = ["fr", "en"];

export type ColumnGeneratorKind =
  | "auto"
  | "sequence"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "city"
  | "country"
  | "company"
  | "word"
  | "sentence"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "uuid"
  | "oneOf"
  | "fixed"
  | "null"
  | "foreignKey";

export const COLUMN_GENERATORS: readonly ColumnGeneratorKind[] = [
  "auto",
  "sequence",
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "city",
  "country",
  "company",
  "word",
  "sentence",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "uuid",
  "oneOf",
  "fixed",
  "null",
  "foreignKey",
];

/**
 * How one column is filled. `min`/`max`: numbers, or `YYYY-MM-DD` for dates.
 * `values`: `oneOf`'s choices, with optional `weights` (same length).
 * `nullRatio`: share of NULLs, ignored on a NOT NULL column.
 */
export interface ColumnGeneratorConfig {
  kind: ColumnGeneratorKind;
  min?: number | string;
  max?: number | string;
  scale?: number;
  values?: string[];
  weights?: number[];
  value?: string;
  nullRatio?: number;
}

/** A table's generation settings, keyed by field id — saved per table so a run can be repeated. */
export interface TableGeneratorConfig {
  rows: number;
  seed: number;
  locale: GeneratorLocale;
  columns: Record<string, ColumnGeneratorConfig>;
}

/** Rows one run may produce: enough for a test set, small enough to stay a seed. */
export const GENERATOR_MAX_ROWS = 10_000;

/** Mulberry32: tiny, seeded, good enough to vary test data — not for anything secret. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATA: Record<
  GeneratorLocale,
  {
    first: string[];
    last: string[];
    cities: string[];
    words: string[];
    companies: string[];
    domain: string;
    phone: (r: () => number) => string;
    country: string[];
  }
> = {
  fr: {
    first: [
      "Camille",
      "Léa",
      "Manon",
      "Chloé",
      "Inès",
      "Louise",
      "Jade",
      "Hugo",
      "Lucas",
      "Louis",
      "Gabriel",
      "Arthur",
      "Jules",
      "Nathan",
      "Théo",
      "Zoé",
      "Élise",
      "Noé",
      "Amélie",
      "Étienne",
    ],
    last: [
      "Martin",
      "Bernard",
      "Dubois",
      "Thomas",
      "Robert",
      "Richard",
      "Petit",
      "Durand",
      "Leroy",
      "Moreau",
      "Simon",
      "Laurent",
      "Lefèvre",
      "Michel",
      "Garcia",
      "David",
      "Bertrand",
      "Roux",
      "Vincent",
      "Fournier",
    ],
    cities: [
      "Paris",
      "Lyon",
      "Marseille",
      "Toulouse",
      "Nice",
      "Nantes",
      "Strasbourg",
      "Montpellier",
      "Bordeaux",
      "Lille",
      "Rennes",
      "Reims",
      "Dijon",
      "Grenoble",
      "Angers",
    ],
    words: [
      "projet",
      "client",
      "commande",
      "facture",
      "livraison",
      "service",
      "produit",
      "contrat",
      "équipe",
      "rapport",
      "dossier",
      "agence",
      "budget",
      "devis",
      "stock",
    ],
    companies: ["Atelier", "Groupe", "Société", "Maison", "Compagnie"],
    domain: "exemple.fr",
    phone: (r) =>
      `0${1 + Math.floor(r() * 7)} ${Array.from({ length: 4 }, () => String(Math.floor(r() * 100)).padStart(2, "0")).join(" ")}`,
    country: ["FR", "BE", "CH", "LU", "CA"],
  },
  en: {
    first: [
      "Olivia",
      "Emma",
      "Ava",
      "Sophia",
      "Mia",
      "Amelia",
      "Liam",
      "Noah",
      "Oliver",
      "Elijah",
      "James",
      "William",
      "Henry",
      "Lucas",
      "Grace",
      "Ada",
      "Alan",
      "Ruth",
      "Edith",
      "Hugo",
    ],
    last: [
      "Smith",
      "Johnson",
      "Williams",
      "Brown",
      "Jones",
      "Miller",
      "Davis",
      "Wilson",
      "Taylor",
      "Clark",
      "Lewis",
      "Walker",
      "Hall",
      "Young",
      "King",
      "Wright",
      "Hopper",
      "Turing",
      "Lovelace",
      "Baker",
    ],
    cities: [
      "London",
      "Manchester",
      "Bristol",
      "Leeds",
      "Glasgow",
      "Boston",
      "Denver",
      "Austin",
      "Seattle",
      "Dublin",
      "Toronto",
      "Sydney",
      "Chicago",
      "Portland",
      "Oxford",
    ],
    words: [
      "project",
      "customer",
      "order",
      "invoice",
      "delivery",
      "service",
      "product",
      "contract",
      "team",
      "report",
      "file",
      "agency",
      "budget",
      "quote",
      "stock",
    ],
    companies: ["Group", "Labs", "Works", "Partners", "Systems"],
    domain: "example.com",
    phone: (r) =>
      `+1 555 ${String(Math.floor(r() * 1000)).padStart(3, "0")} ${String(Math.floor(r() * 10000)).padStart(4, "0")}`,
    country: ["US", "GB", "IE", "CA", "AU"],
  },
};

function typeOf(field: Field): string {
  return field.type.toLowerCase().trim();
}

function declaredLength(type: string): number | null {
  const match = /^\s*(?:n?var)?char(?:acter)?(?:\s+varying)?2?\s*\(\s*(\d+)/i.exec(type);
  return match ? Number(match[1]) : null;
}

const isInteger = (t: string) => /^(tiny|small|medium|big)?int(eger)?\d*\b|^(small|big)?serial\b|^int[248]\b/.test(t);
const isDecimal = (t: string) => /^(numeric|decimal|number|float\d*|double|real|money)\b/.test(t);

/**
 * The generator a column most likely wants: a foreign key draws from its
 * parent, an auto-increment or serial is left to the database, then the name
 * (`email`, `phone`, `city`, `first_name`…), then the type.
 */
export function suggestGenerator(field: Field, table: Table, refs: readonly Ref[] = []): ColumnGeneratorConfig {
  if (refs.some((ref) => ref.from.tableId === table.id && ref.from.fieldId === field.id)) return { kind: "foreignKey" };
  const t = typeOf(field);
  if (field.increment || /serial\b/.test(t)) return { kind: "auto" };
  if (field.pk && isInteger(t)) return { kind: "sequence" };
  const name = field.name.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(uuid|guid)$/.test(t) || t === "uniqueidentifier") return { kind: "uuid" };
  if (/mail/.test(name)) return { kind: "email" };
  if (/phone|tel|mobile/.test(name)) return { kind: "phone" };
  if (/firstname|prenom|givenname/.test(name)) return { kind: "firstName" };
  if (/lastname|surname|familyname|nomdefamille/.test(name)) return { kind: "lastName" };
  if (/city|ville|town/.test(name)) return { kind: "city" };
  if (/country|pays/.test(name)) return { kind: "country" };
  if (/company|societe|organisation|organization|entreprise/.test(name)) return { kind: "company" };
  if (/^(name|nom|fullname|username|displayname)$/.test(name)) return { kind: "fullName" };
  if (/^bool(ean)?\b|^bit\b/.test(t)) return { kind: "boolean" };
  if (/^date$/.test(t)) return { kind: "date", min: "2024-01-01", max: "2026-12-31" };
  if (/^(timestamp|datetime|smalldatetime|datetime2|timestamptz)\b/.test(t)) {
    return { kind: "datetime", min: "2024-01-01", max: "2026-12-31" };
  }
  if (isInteger(t)) return { kind: "integer", min: 0, max: 1000 };
  if (isDecimal(t)) return { kind: "decimal", min: 0, max: 1000, scale: 2 };
  if (/desc|note|comment|text|body|content/.test(name) || t === "text") return { kind: "sentence" };
  return { kind: "word" };
}

export interface GeneratorContext {
  /** Values of referenced columns, keyed `tableId.fieldId` — e.g. from the parent table's seed. */
  parentValues?: ReadonlyMap<string, ReadonlySet<string>>;
  refs?: readonly Ref[];
}

export interface GeneratedRows {
  /** The fields that get a value — `auto` columns are left to the database and not listed. */
  columns: Field[];
  rows: (string | null)[][];
  /** Columns that could not be filled as asked (e.g. a NOT NULL foreign key with no parent rows), by field name. */
  problems: { column: string; reason: "no-parent-values" | "unique-exhausted" }[];
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".");
}

function dayRange(min: number | string | undefined, max: number | string | undefined): [number, number] {
  const from = Date.parse(String(min ?? "2024-01-01"));
  const to = Date.parse(String(max ?? "2026-12-31"));
  return [Number.isNaN(from) ? Date.UTC(2024, 0, 1) : from, Number.isNaN(to) ? Date.UTC(2026, 11, 31) : to];
}

function valueFor(
  config: ColumnGeneratorConfig,
  field: Field,
  index: number,
  random: () => number,
  locale: GeneratorLocale,
  parents: readonly string[] | undefined,
): string | null {
  const data = DATA[locale];
  const n = (v: number | string | undefined, fallback: number) =>
    typeof v === "number" ? v : v === undefined || v === "" ? fallback : Number(v);
  switch (config.kind) {
    case "auto":
    case "null":
      return null;
    case "sequence":
      return String(n(config.min, 1) + index);
    case "firstName":
      return pick(random, data.first);
    case "lastName":
      return pick(random, data.last);
    case "fullName":
      return `${pick(random, data.first)} ${pick(random, data.last)}`;
    case "email":
      return `${slug(pick(random, data.first))}.${slug(pick(random, data.last))}${index + 1}@${data.domain}`;
    case "phone":
      return data.phone(random);
    case "city":
      return pick(random, data.cities);
    case "country":
      return pick(random, data.country);
    case "company":
      return `${pick(random, data.companies)} ${pick(random, data.last)}`;
    case "word":
      return pick(random, data.words);
    case "sentence": {
      const words = Array.from({ length: 4 + Math.floor(random() * 8) }, () => pick(random, data.words));
      const text = words.join(" ");
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
    }
    case "integer": {
      const lo = Math.ceil(n(config.min, 0));
      const hi = Math.floor(n(config.max, 1000));
      return String(lo + Math.floor(random() * (Math.max(hi, lo) - lo + 1)));
    }
    case "decimal": {
      const lo = n(config.min, 0);
      const hi = n(config.max, 1000);
      return (lo + random() * (Math.max(hi, lo) - lo)).toFixed(Math.max(0, Math.min(10, config.scale ?? 2)));
    }
    case "boolean":
      return random() < 0.5 ? "true" : "false";
    case "date":
    case "datetime": {
      const [from, to] = dayRange(config.min, config.max);
      const at = new Date(from + Math.floor(random() * Math.max(0, to - from)));
      const iso = at.toISOString();
      return config.kind === "date" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
    }
    case "uuid": {
      const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
    }
    case "oneOf": {
      const values = config.values ?? [];
      if (values.length === 0) return null;
      const weights = config.weights?.length === values.length ? config.weights : values.map(() => 1);
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0) || 1;
      let roll = random() * total;
      for (let i = 0; i < values.length; i++) {
        roll -= Math.max(0, weights[i]);
        if (roll < 0) return values[i];
      }
      return values[values.length - 1];
    }
    case "fixed":
      return config.value ?? "";
    case "foreignKey":
      return parents && parents.length > 0 ? pick(random, parents) : null;
  }
  return field.notNull ? "" : null;
}

/**
 * `rows` rows for `table`. Per column, the configured generator or the
 * suggested one. NOT NULL columns never get a NULL (their `nullRatio` is
 * ignored); text is cut to the column's declared length; a PK / UNIQUE
 * column retries, then gives up and reports it rather than emit a duplicate.
 * A foreign key draws from `context.parentValues`; with none, a nullable one
 * stays NULL and a NOT NULL one is reported.
 */
export function generateRows(
  table: Table,
  config: Pick<TableGeneratorConfig, "rows" | "seed" | "locale" | "columns">,
  context: GeneratorContext = {},
): GeneratedRows {
  const random = seededRandom(config.seed);
  const rowCount = Math.max(0, Math.min(GENERATOR_MAX_ROWS, Math.floor(config.rows)));
  const plans = table.fields.map((field) => ({
    field,
    config: config.columns[field.id] ?? suggestGenerator(field, table, context.refs),
  }));
  const used = plans.filter((plan) => plan.config.kind !== "auto");
  const uniqueFields = new Set(
    table.fields.filter((f) => f.unique || (f.pk && !table.fields.some((o) => o !== f && o.pk))).map((f) => f.id),
  );
  const problems: GeneratedRows["problems"] = [];
  const parentsOf = new Map<string, string[] | undefined>();
  for (const plan of used) {
    if (plan.config.kind !== "foreignKey") continue;
    const ref = context.refs?.find((r) => r.from.tableId === table.id && r.from.fieldId === plan.field.id);
    const values = ref ? context.parentValues?.get(`${ref.to.tableId}.${ref.to.fieldId}`) : undefined;
    parentsOf.set(plan.field.id, values ? [...values] : undefined);
    if ((!values || values.size === 0) && (plan.field.notNull || plan.field.pk)) {
      problems.push({ column: plan.field.name, reason: "no-parent-values" });
    }
  }
  const seen = new Map(used.map((plan) => [plan.field.id, new Set<string>()]));
  const exhausted = new Set<string>();
  const rows: (string | null)[][] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(
      used.map(({ field, config: column }) => {
        const nullable = !field.notNull && !field.pk;
        if (nullable && (column.nullRatio ?? 0) > 0 && random() < (column.nullRatio ?? 0)) return null;
        const limit = declaredLength(typeOf(field));
        const unique = uniqueFields.has(field.id);
        let value: string | null = null;
        for (let attempt = 0; attempt < (unique ? 20 : 1); attempt++) {
          value = valueFor(column, field, i, random, config.locale, parentsOf.get(field.id));
          if (value !== null && limit !== null) value = [...value].slice(0, limit).join("");
          if (!unique || value === null || !seen.get(field.id)!.has(value)) break;
          // A word or a name repeats quickly: make it distinct before giving up.
          if (attempt === 18 && value !== null) value = `${value}${i + 1}`.slice(0, limit ?? Infinity);
        }
        if (unique && value !== null) {
          if (seen.get(field.id)!.has(value)) exhausted.add(field.name);
          seen.get(field.id)!.add(value);
        }
        return value;
      }),
    );
  }
  for (const column of exhausted) problems.push({ column, reason: "unique-exhausted" });
  return { columns: used.map((plan) => plan.field), rows, problems };
}

/** RFC 4180 CSV, `,`-separated, header first; NULL is an empty unquoted cell, the empty string `""`. */
export function toCsv(columns: readonly string[], rows: readonly (readonly (string | null)[])[]): string {
  const cell = (value: string | null) => {
    if (value === null) return "";
    if (value === "" || /[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  return [columns.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))].join("\n") + "\n";
}
