import type { DataClassification, DataDictionary } from "@nebuladb/dbml-engine";

/** Words of the document: the PDF is written in the language of the interface, unlike the other exports. */
export interface DictionaryPdfLabels {
  /** The title line: the project name and what the document is. */
  title: string;
  /** The date the document was made, already formatted. */
  date: string;
  /** "42% described — 5 tables, 38 columns". */
  summary: string;
  column: string;
  type: string;
  constraints: string;
  classification: string;
  description: string;
  value: string;
  owner: string;
  tags: string;
  usedBy: string;
  enums: string;
  classes: Record<DataClassification, string>;
}

const MARGIN = 40;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
/** Room kept under the content for the page number. */
const FOOTER = 28;
const BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER / 2;
const LEADING = 1.25;
const CELL_PAD = 3;
const BODY_SIZE = 8.5;
/** A table starts on a new page unless its heading, its header and this many rows fit under it. */
const KEEP_ROWS = 2;

/** Windows-1252 beyond Latin-1: the other characters a standard PDF font can show. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * The text a standard PDF font (no embedded font file, so a small document) can show: French and
 * the other Western European accents are all there; what is not (an arrow, a letter of another
 * script) is replaced rather than drawn as garbage.
 */
function printable(text: string): string {
  return text
    .normalize("NFC")
    .replace(/→/g, "->")
    .replace(/\t/g, "  ")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/gu, (char) => (WIN_ANSI_EXTRA.has(char) ? char : "?"));
}

/**
 * The data dictionary as a PDF: real text (selectable, searchable), tables then enums as in the other
 * exports, a table never cut inside a row unless one row alone is taller than a page.
 */
export async function dictionaryToPdf(dictionary: DataDictionary, labels: DictionaryPdfLabels): Promise<Blob> {
  // jsPDF is only needed here — a dynamic import keeps it out of the bundle everyone else loads.
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  pdf.setProperties({ title: printable(labels.title), subject: printable(labels.summary) });

  let y = MARGIN;
  const newPage = () => {
    pdf.addPage();
    y = MARGIN;
  };
  const setFont = (size: number, style: "normal" | "bold" | "italic" = "normal") => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
  };
  const lineHeight = (size: number) => size * LEADING;
  const wrap = (text: string, width: number): string[] => {
    // Blank lines are kept (they separate paragraphs); `splitTextToSize` would drop them.
    return printable(text)
      .split("\n")
      .flatMap((line) => (line.trim() === "" ? [""] : (pdf.splitTextToSize(line, width) as string[])));
  };
  const room = (height: number) => y + height <= BOTTOM;

  /** A paragraph in the current font, which can flow over a page. */
  const paragraph = (text: string, size: number, style: "normal" | "bold" | "italic" = "normal", color = 40) => {
    setFont(size, style);
    pdf.setTextColor(color);
    for (const line of wrap(text, CONTENT_WIDTH)) {
      if (!room(lineHeight(size))) newPage();
      pdf.text(line, MARGIN, y + size);
      y += lineHeight(size);
    }
  };

  interface Row {
    cells: string[][];
  }
  const rowHeight = (row: Row, size: number) =>
    Math.max(...row.cells.map((lines) => lines.length)) * lineHeight(size) + 2 * CELL_PAD;

  /** One table: a header repeated on each page, rows never cut unless a single row is taller than the page. */
  const table = (head: string[], widths: number[], rows: string[][], boldColumns: number[] = []) => {
    const size = BODY_SIZE;
    const total = widths.reduce((sum, width) => sum + width, 0);
    const scale = CONTENT_WIDTH / total;
    const columns = widths.map((width) => width * scale);
    const fit = (cells: string[], style: "normal" | "bold"): Row => {
      setFont(size, style);
      return { cells: cells.map((cell, index) => wrap(cell, columns[index] - 2 * CELL_PAD)) };
    };
    const header = fit(head, "bold");
    const maxLines = Math.floor((BOTTOM - MARGIN - rowHeight(header, size) - 2 * CELL_PAD) / lineHeight(size));
    // A row taller than a page is the one case where cutting it cannot be avoided.
    const body = rows.flatMap((cells): Row[] => {
      const row = fit(cells, "normal");
      const longest = Math.max(...row.cells.map((lines) => lines.length));
      if (longest <= maxLines) return [row];
      return Array.from({ length: Math.ceil(longest / maxLines) }, (_, part) => ({
        cells: row.cells.map((lines) => lines.slice(part * maxLines, (part + 1) * maxLines)),
      }));
    });

    const drawRow = (row: Row, isHeader: boolean) => {
      const height = rowHeight(row, size);
      if (isHeader) {
        pdf.setFillColor(238, 241, 244);
        pdf.rect(MARGIN, y, CONTENT_WIDTH, height, "F");
      }
      pdf.setDrawColor(205, 211, 218);
      pdf.setLineWidth(0.5);
      pdf.line(MARGIN, y + height, MARGIN + CONTENT_WIDTH, y + height);
      let x = MARGIN;
      row.cells.forEach((lines, index) => {
        setFont(size, isHeader || boldColumns.includes(index) ? "bold" : "normal");
        pdf.setTextColor(isHeader ? 60 : 30);
        lines.forEach((line, lineIndex) => {
          pdf.text(line, x + CELL_PAD, y + CELL_PAD + size + lineIndex * lineHeight(size));
        });
        x += columns[index];
      });
      y += height;
    };

    const firstRows = body.slice(0, KEEP_ROWS).reduce((sum, row) => sum + rowHeight(row, size), 0);
    if (!room(rowHeight(header, size) + firstRows)) newPage();
    drawRow(header, true);
    for (const row of body) {
      if (!room(rowHeight(row, size))) {
        newPage();
        drawRow(header, true);
      }
      drawRow(row, false);
    }
    y += 12;
  };

  /** A heading, kept with what follows it: it never ends a page alone. */
  const heading = (text: string, size: number, needed: number) => {
    if (!room(lineHeight(size) + needed)) newPage();
    paragraph(text, size, "bold", 20);
    y += 3;
  };

  setFont(18, "bold");
  pdf.setTextColor(20);
  for (const line of wrap(labels.title, CONTENT_WIDTH)) {
    pdf.text(line, MARGIN, y + 18);
    y += lineHeight(18);
  }
  paragraph(`${labels.date} - ${labels.summary}`, 9, "normal", 100);
  y += 12;

  const descriptionBlock = (description: string) => {
    if (description) {
      paragraph(description, 9.5);
      y += 3;
    }
  };
  const columnWidths = [105, 85, 85, 62, 178];
  for (const entry of dictionary.tables) {
    const facts = [
      entry.owner ? `${labels.owner}: ${entry.owner}` : "",
      entry.tags.length > 0 ? `${labels.tags}: ${entry.tags.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("  -  ");
    const name = `${entry.schemaName ? `${entry.schemaName}.` : ""}${entry.name}`;
    const classification = entry.classification ? `  [${labels.classes[entry.classification]}]` : "";
    // The heading, its first lines of description and the first rows go together.
    heading(`${name}${classification}`, 12, lineHeight(9.5) * Math.min(2, entry.description.split("\n").length) + 40);
    descriptionBlock(entry.description);
    if (facts) {
      paragraph(facts, 8.5, "italic", 90);
      y += 3;
    }
    table(
      [labels.column, labels.type, labels.constraints, labels.classification, labels.description],
      columnWidths,
      entry.columns.map((column) => [
        column.name,
        column.type,
        column.constraints.join(", "),
        column.classification ? labels.classes[column.classification] : "",
        [column.description, column.tags.length > 0 ? `(${column.tags.join(", ")})` : ""]
          .filter(Boolean)
          .join(column.description.includes("\n") ? "\n" : " "),
      ]),
      [0],
    );
  }

  if (dictionary.enums.length > 0) {
    if (!room(60)) newPage();
    paragraph(labels.enums, 15, "bold", 20);
    y += 6;
  }
  for (const def of dictionary.enums) {
    heading(def.name, 12, 50);
    if (def.usedBy.length > 0) {
      paragraph(`${labels.usedBy}: ${def.usedBy.join(", ")}`, 8.5, "italic", 90);
      y += 3;
    }
    table(
      [labels.value, labels.description],
      [140, 375],
      def.values.map((value) => [value.name, value.description]),
      [0],
    );
  }

  // The page numbers need the page count, so they come last.
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    setFont(8);
    pdf.setTextColor(120);
    pdf.text(printable(dictionary.projectName), MARGIN, PAGE_HEIGHT - MARGIN + 6);
    pdf.text(`${page} / ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN + 6, { align: "right" });
  }
  return pdf.output("blob");
}
