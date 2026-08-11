import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";

const INDENT = "  ";
const IDENT = `(?:"[^"\\n]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const FIELD_RE = new RegExp(`^(${IDENT})\\s+(${IDENT}(?:\\([^)]*\\))?(?:\\[\\])?)\\s*(\\[.*\\])?\\s*$`);
const TOP_BLOCK_RE = /^(Table|Ref|Enum|TableGroup|Project|Note)\b/i;

interface Row {
  /** final text when not part of an aligned run */
  text: string;
  blank: boolean;
  indent: string;
  /** set for `name type [settings]` rows so they can be column-aligned */
  field?: { name: string; type: string; settings: string };
}

/**
 * Normalizes spacing outside quoted strings/backticks: collapses space runs and
 * puts a single space after `,` and `:`. Everything inside quotes is copied
 * through untouched, so notes and default values keep their exact text.
 */
function normalizeSpacing(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      out += text.slice(i);
      break;
    }
    if (ch === " " && out.endsWith(" ")) continue;
    if ((ch === "," || ch === ":") && out.endsWith(" ")) out = out.slice(0, -1);
    out += ch;
    if ((ch === "," || ch === ":") && text[i + 1] !== undefined && text[i + 1] !== " " && text[i + 1] !== ch) {
      out += " ";
    }
  }
  return out
    .replace(/\s*\{\s*$/, " {")
    // keep numeric type arguments tight: `decimal(10, 2)` -> `decimal(10,2)`
    .replace(/\((\d[\d,\s]*)\)/g, (_m, args: string) => `(${args.replace(/\s+/g, "")})`)
    .replace(/\s+$/, "");
}

/** Brace delta of a line, ignoring braces inside strings and `//` comments. */
function braceDelta(text: string): number {
  let delta = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") break;
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

/**
 * Pretty-prints DBML: consistent 2-space block indentation, one blank line
 * between top-level blocks, no trailing whitespace, and column/type/settings
 * aligned per table block. Multi-line `'''` notes and block comments are left
 * byte-for-byte untouched.
 */
export function formatDbml(source: string): string {
  const lines = source.split(/\r?\n/);
  const rows: Row[] = [];
  let depth = 0;
  let inTriple = false;
  let inBlockComment = false;
  let topBlockIsTable = false;

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (inTriple) {
      rows.push({ text: raw.replace(/\s+$/, ""), blank: trimmed.length === 0, indent: "" });
      if (trimmed.includes("'''")) inTriple = false;
      continue;
    }
    if (inBlockComment) {
      rows.push({ text: raw.replace(/\s+$/, ""), blank: trimmed.length === 0, indent: "" });
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }

    if (!trimmed) {
      rows.push({ text: "", blank: true, indent: "" });
      continue;
    }

    const tripleCount = (trimmed.match(/'''/g) ?? []).length;
    const opensTriple = tripleCount % 2 === 1;
    const opensComment = trimmed.includes("/*") && !trimmed.includes("*/");

    const closesFirst = trimmed.startsWith("}");
    if (closesFirst) depth = Math.max(0, depth - 1);

    const indent = INDENT.repeat(depth);
    const body = normalizeSpacing(trimmed);

    if (depth === 0 && TOP_BLOCK_RE.test(body)) {
      topBlockIsTable = /^Table\b/i.test(body);
      // one blank line between top-level blocks, but keep runs of single-line
      // `Ref:` declarations packed together the way people write them
      const prev = rows[rows.length - 1];
      const singleLineRef = /^Ref\b/i.test(body) && !body.endsWith("{");
      const prevIsRefLine = prev && !prev.blank && /^\s*Ref\b/i.test(prev.text) && !prev.text.endsWith("{");
      if (prev && !prev.blank && !(singleLineRef && prevIsRefLine)) {
        rows.push({ text: "", blank: true, indent: "" });
      }
    }

    const fieldMatch = depth === 1 && topBlockIsTable && !closesTop(body) ? FIELD_RE.exec(body) : null;
    if (fieldMatch) {
      rows.push({
        text: indent + body,
        blank: false,
        indent,
        field: { name: fieldMatch[1], type: fieldMatch[2], settings: fieldMatch[3] ?? "" },
      });
    } else {
      rows.push({ text: indent + body, blank: false, indent });
    }

    depth += braceDelta(body) + (closesFirst ? 1 : 0);
    depth = Math.max(0, depth);
    if (depth === 0) topBlockIsTable = false;
    if (opensTriple) inTriple = true;
    if (opensComment) inBlockComment = true;
  }

  alignFieldRuns(rows);

  // drop blank lines right after `{`, right before `}`, and collapse repeats
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.blank) {
      const prev = out[out.length - 1];
      const next = rows.slice(i + 1).find((r) => !r.blank);
      if (prev === undefined || prev.trim().endsWith("{") || prev.trim() === "") continue;
      if (next && next.text.trim().startsWith("}")) continue;
      out.push("");
      continue;
    }
    out.push(row.text);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

function closesTop(body: string): boolean {
  return body.startsWith("}");
}

/** Pads name/type columns across each run of consecutive field rows. */
function alignFieldRuns(rows: Row[]) {
  let start = 0;
  while (start < rows.length) {
    if (!rows[start].field) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < rows.length && rows[end + 1].field) end += 1;
    const run = rows.slice(start, end + 1);
    const nameWidth = Math.max(...run.map((r) => r.field!.name.length));
    const typeWidth = Math.max(...run.map((r) => (r.field!.settings ? r.field!.type.length : 0)));
    for (const row of run) {
      const f = row.field!;
      row.text = f.settings
        ? `${row.indent}${f.name.padEnd(nameWidth)} ${f.type.padEnd(typeWidth)} ${f.settings}`
        : `${row.indent}${f.name.padEnd(nameWidth)} ${f.type}`;
    }
    start = end + 1;
  }
}

/** Shift+Alt+F — reformat the document, keeping the cursor on the same line. */
export const formatDocument: Command = (view) => {
  const current = view.state.doc.toString();
  const formatted = formatDbml(current);
  if (formatted === current) return true;
  const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: formatted },
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
  });
  const target = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  view.dispatch({ selection: EditorSelection.cursor(target.from), scrollIntoView: true });
  return true;
};
