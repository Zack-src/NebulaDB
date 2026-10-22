import type { Field, Table } from "./schema.js";
import {
  SEED_MAX_ISSUES,
  declaredLength,
  fitsType,
  isRequired,
  typeFamily,
  type SeedIssue,
  type SeedOptions,
  type SeedOverflow,
  type SeedSeparator,
  type SeedValidationContext,
} from "./seeds.js";

/**
 * Seeds read in a stream. A big seed is never held as one string or one array of rows: the CSV is parsed as
 * it arrives, and each row is checked and let go. `parseCsv` + `validateSeed` (the small seeds' path) are the
 * same code run over everything at once, so the editor's preview and the server's checks cannot disagree.
 */

const CR = "\r";
const LF = "\n";
const QUOTE = '"';
const BOM = "﻿";
const NUL = String.fromCharCode(0);

/**
 * `parseCsv`, fed piece by piece. Same rules (RFC 4180, a leading BOM dropped, an unquoted empty cell is NULL,
 * a blank line is not a row); a quote or a CR that ends a piece is held until the next one says what it was.
 */
export class CsvStreamParser {
  private rows: (string | null)[][] = [];
  private row: (string | null)[] = [];
  private cell = "";
  private quoted = false;
  private wasQuoted = false;
  /** A quote was read inside a quoted cell: closing, or the first half of an escaped one. */
  private pendingQuote = false;
  /** A CR ended a row: a LF right after it belongs to the same line break. */
  private pendingCr = false;
  private atStart = true;

  constructor(private readonly separator: SeedSeparator) {}

  private endCell(): void {
    this.row.push(this.cell === "" && !this.wasQuoted ? null : this.cell);
    this.cell = "";
    this.wasQuoted = false;
  }

  private endRow(): void {
    this.endCell();
    if (!(this.row.length === 1 && this.row[0] === null)) this.rows.push(this.row);
    this.row = [];
  }

  /** The rows completed by this piece of text. */
  push(chunk: string): (string | null)[][] {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (this.atStart) {
        this.atStart = false;
        if (ch === BOM) continue;
      }
      if (this.pendingCr) {
        this.pendingCr = false;
        if (ch === LF) continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === QUOTE) {
          this.cell += QUOTE;
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === QUOTE) this.pendingQuote = true;
        else this.cell += ch;
        continue;
      }
      if (ch === QUOTE && this.cell === "") {
        this.quoted = true;
        this.wasQuoted = true;
      } else if (ch === this.separator) {
        this.endCell();
      } else if (ch === CR || ch === LF) {
        this.endRow();
        if (ch === CR) this.pendingCr = true;
      } else {
        this.cell += ch;
      }
    }
    const done = this.rows;
    this.rows = [];
    return done;
  }

  /** The last row, when the text did not end with a line break. */
  end(): (string | null)[][] {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.quoted = false;
    }
    if (this.cell !== "" || this.wasQuoted || this.row.length > 0) this.endRow();
    const done = this.rows;
    this.rows = [];
    return done;
  }
}

export interface SeedValidatorLimits {
  /**
   * How many values the checks may keep in memory in all (primary key, UNIQUE and parent-key sets). A set
   * that would go past it is dropped and named in `unchecked`: that check is not made, nothing else is lost.
   */
  maxKeys?: number;
  /** Ids of the fields whose values to gather for the tables that point at them (`SeedValidatorResult.values`). */
  collect?: ReadonlySet<string>;
}

export interface SeedValidatorResult {
  issues: SeedIssue[];
  total: number;
  /** How many of the `total` are warnings (the rest are errors). */
  warnings: number;
  /** Data rows read (header excluded). */
  rows: number;
  overflows: SeedOverflow[];
  /** Checks given up on for lack of room: `unique: <columns>`, `values: <column>` (a child's foreign key is then not checked). */
  unchecked: string[];
  /** The gathered values, keyed `tableId.fieldId`; a column missing from it was too big to gather. */
  values: Map<string, Set<string>>;
}

interface UniqueSet {
  label: string;
  indexes: number[];
  /** `null`: dropped for lack of room. */
  seen: Set<string> | null;
}

/**
 * What would make the insert fail or surprise, row by row: a NULL in a NOT NULL column, a value that is not of
 * the column's type or longer than its limit, a duplicate under a primary key or UNIQUE, a foreign key with no
 * parent among the parent table's own seed, a required column the CSV does not fill, a row of the wrong width.
 * Formula-looking text (`=`, `+`, `-`, `@` first) is a warning: stored as text, but run by a spreadsheet that
 * opens an export. So is a CSV column mapped to a table column that no longer exists.
 *
 * Feed it every row of the file, header included, then `finish()`.
 */
export class SeedValidator {
  private readonly issues: SeedIssue[] = [];
  private total = 0;
  private warningCount = 0;
  private rowCount = 0;
  private started = false;
  private readonly columns: Field[];
  private readonly picked: number[] = [];
  private readonly width: number;
  private readonly families: ReturnType<typeof typeFamily>[];
  private readonly limits: (number | null)[];
  private readonly uniqueSets: UniqueSet[] = [];
  private readonly foreignKeys: { position: number; parent: ReadonlySet<string> }[];
  private readonly overflowAt: { longest: number; count: number }[];
  private readonly gather: { key: string; position: number; set: Set<string> | null }[] = [];
  private readonly unchecked: string[] = [];
  private budget: number;

  constructor(
    private readonly table: Table,
    private readonly options: Pick<SeedOptions, "header" | "mapping">,
    context: SeedValidationContext = {},
    limits: SeedValidatorLimits = {},
  ) {
    this.budget = limits.maxKeys ?? Number.POSITIVE_INFINITY;
    this.width = options.mapping.length;
    const picked: Field[] = [];
    options.mapping.forEach((fieldId, index) => {
      const field = fieldId ? table.fields.find((f) => f.id === fieldId) : undefined;
      if (field) {
        picked.push(field);
        this.picked.push(index);
      }
    });
    this.columns = picked;
    this.families = picked.map((field) => typeFamily(field.type));
    this.limits = picked.map((field) => declaredLength(field.type));
    this.overflowAt = picked.map(() => ({ longest: 0, count: 0 }));

    const pk = picked.map((field, i) => (field.pk ? i : -1)).filter((i) => i >= 0);
    if (pk.length > 0) this.uniqueSets.push({ label: pk.map((i) => picked[i].name).join(", "), indexes: pk, seen: new Set() });
    picked.forEach((field, i) => {
      if (field.unique && !field.pk) this.uniqueSets.push({ label: field.name, indexes: [i], seen: new Set() });
    });
    for (const index of table.indexes) {
      if (!index.unique && !index.pk) continue;
      const positions = index.fieldIds.map((id) => picked.findIndex((field) => field.id === id));
      if (positions.some((p) => p < 0)) continue;
      this.uniqueSets.push({ label: positions.map((p) => picked[p].name).join(", "), indexes: positions, seen: new Set() });
    }

    this.foreignKeys = (context.refs ?? [])
      .filter((ref) => ref.from.tableId === table.id)
      .map((ref) => {
        const key = `${ref.to.tableId}.${ref.to.fieldId}`;
        return {
          position: picked.findIndex((field) => field.id === ref.from.fieldId),
          parent: context.incompleteParents?.has(key) ? undefined : context.parentValues?.get(key),
        };
      })
      .filter((fk): fk is { position: number; parent: ReadonlySet<string> } => fk.position >= 0 && fk.parent !== undefined);

    picked.forEach((field, position) => {
      if (limits.collect?.has(field.id)) this.gather.push({ key: `${table.id}.${field.id}`, position, set: new Set() });
    });
  }

  private report(issue: SeedIssue): void {
    this.total++;
    if (issue.severity === "warning") this.warningCount++;
    if (this.issues.length < SEED_MAX_ISSUES) this.issues.push(issue);
  }

  /** The file-level checks, once the header (if any) is known. */
  private start(header: (string | null)[] | null): void {
    this.started = true;
    this.options.mapping.forEach((fieldId, index) => {
      if (!fieldId || this.table.fields.some((field) => field.id === fieldId)) return;
      const name = this.options.header ? header?.[index] : null;
      this.report({ kind: "column-gone", row: 0, value: name || `#${index + 1}`, severity: "warning" });
    });
    const mapped = new Set(this.columns.map((field) => field.id));
    for (const field of this.table.fields) {
      if (!mapped.has(field.id) && isRequired(field)) {
        this.report({ kind: "missing-column", row: 0, column: field.name, severity: "error" });
      }
    }
  }

  /** Keeps `key` in `seen`, or drops the whole set when the memory allowance is spent. Returns whether it was already there. */
  private remember(set: UniqueSet, key: string): boolean {
    if (!set.seen) return false;
    if (set.seen.has(key)) return true;
    if (this.budget <= 0) {
      set.seen = null;
      this.unchecked.push(`unique: ${set.label}`);
      return false;
    }
    this.budget--;
    set.seen.add(key);
    return false;
  }

  add(cells: (string | null)[]): void {
    if (this.options.header && !this.started) {
      this.start(cells);
      return;
    }
    if (!this.started) this.start(null);
    const rowNumber = ++this.rowCount;
    if (cells.length !== this.width) this.report({ kind: "width", row: rowNumber, value: String(cells.length), severity: "error" });

    const row = this.picked.map((index) => cells[index] ?? null);
    row.forEach((value, c) => {
      const field = this.columns[c];
      if (value === null) {
        if (field.notNull || field.pk) this.report({ kind: "not-null", row: rowNumber, column: field.name, severity: "error" });
        return;
      }
      if (!fitsType(value, this.families[c])) {
        this.report({ kind: "type", row: rowNumber, column: field.name, value, severity: "error" });
      } else {
        const limit = this.limits[c];
        if (limit !== null && value.length > limit) {
          const length = [...value].length;
          if (length > limit) {
            this.report({ kind: "length", row: rowNumber, column: field.name, value, severity: "error" });
            const seen = this.overflowAt[c];
            seen.count++;
            seen.longest = Math.max(seen.longest, length);
          }
        }
      }
      if (this.families[c] === "text" && /^[=+\-@\t\r]/.test(value) && !/^[-+]?\d/.test(value)) {
        this.report({ kind: "formula", row: rowNumber, column: field.name, value, severity: "warning" });
      }
    });

    for (const set of this.uniqueSets) {
      const parts = set.indexes.map((i) => row[i]);
      if (parts.some((part) => part === null)) continue;
      const key = parts.length === 1 ? (parts[0] as string) : parts.join(NUL);
      if (this.remember(set, key)) {
        this.report({ kind: "unique", row: rowNumber, column: set.label, value: parts.join(", "), severity: "error" });
      }
    }
    for (const fk of this.foreignKeys) {
      const value = row[fk.position];
      if (value !== null && !fk.parent.has(value)) {
        this.report({ kind: "foreign-key", row: rowNumber, column: this.columns[fk.position].name, value, severity: "error" });
      }
    }
    for (const gathered of this.gather) {
      const value = row[gathered.position];
      if (value === null || gathered.set === null) continue;
      if (gathered.set.has(value)) continue;
      if (this.budget <= 0) {
        gathered.set = null;
        this.unchecked.push(`values: ${this.columns[gathered.position].name}`);
        continue;
      }
      this.budget--;
      gathered.set.add(value);
    }
  }

  finish(): SeedValidatorResult {
    if (!this.started) this.start(null);
    const overflows: SeedOverflow[] = [];
    this.columns.forEach((field, c) => {
      const limit = this.limits[c];
      if (limit !== null && this.overflowAt[c].count > 0) {
        overflows.push({ column: field.name, limit, longest: this.overflowAt[c].longest, count: this.overflowAt[c].count });
      }
    });
    const values = new Map<string, Set<string>>();
    for (const gathered of this.gather) if (gathered.set) values.set(gathered.key, gathered.set);
    return { issues: this.issues, total: this.total, warnings: this.warningCount, rows: this.rowCount, overflows, unchecked: this.unchecked, values };
  }
}

/** `SeedValidator` over a file already parsed in memory — what the editor and the small seeds use. */
export function validateSeed(
  table: Table,
  parsed: (string | null)[][],
  options: Pick<SeedOptions, "header" | "mapping">,
  context: SeedValidationContext = {},
): { issues: SeedIssue[]; total: number } {
  const validator = new SeedValidator(table, options, context);
  for (const cells of parsed) validator.add(cells);
  const { issues, total } = validator.finish();
  return { issues, total };
}
