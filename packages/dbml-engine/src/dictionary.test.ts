import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@nebuladb/shared";
import {
  buildDictionary,
  completenessPercent,
  dictionaryToCsv,
  dictionaryToHtml,
  dictionaryToMarkdown,
  formatNote,
  parseNote,
  readableNote,
} from "./dictionary.js";
import { projectToDbml } from "./serialize.js";
import { parseDbml, toProject } from "./dbml.js";
import { lintProject } from "./lint.js";

const project: Project = {
  id: "p1",
  name: "Shop",
  tables: [
    {
      id: "t2",
      name: "orders",
      note: "lint-ignore: timestamps",
      fields: [
        { id: "o1", name: "id", type: "integer", pk: true },
        { id: "o2", name: "customer_id", type: "integer", notNull: true, note: "Who bought. [class: internal]" },
      ],
      indexes: [],
      position: { x: 0, y: 0 },
      detailLevel: "standard",
    },
    {
      id: "t1",
      name: "customers",
      note: "People who bought | once. [owner: crm-team] [class: personal] [tags: rgpd, core]",
      fields: [
        { id: "c1", name: "id", type: "integer", pk: true },
        { id: "c2", name: "email", type: "varchar(320)", unique: true, note: "[class: personal] [tags: contact]" },
      ],
      indexes: [],
      position: { x: 0, y: 0 },
      detailLevel: "standard",
    },
  ],
  refs: [
    {
      id: "r1",
      from: { tableId: "t2", fieldId: "o2" },
      to: { tableId: "t1", fieldId: "c1" },
      cardinality: "one-to-many",
    },
  ],
  enums: [],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
};

test("a note is read into its description and annotations, and written back", () => {
  const meta = parseNote("Customer accounts. [Owner: crm-team] [class: PERSONAL] [tags: rgpd, core, rgpd]");
  assert.deepEqual(meta, {
    description: "Customer accounts.",
    owner: "crm-team",
    classification: "personal",
    tags: ["rgpd", "core"],
  });
  assert.equal(formatNote(meta), "Customer accounts. [owner: crm-team] [class: personal] [tags: rgpd, core]");
  assert.deepEqual(parseNote(formatNote(meta)), meta);

  assert.deepEqual(parseNote(undefined), { description: "", tags: [] });
  assert.equal(formatNote({ description: "  ", tags: [] }), undefined);
  // An unknown classification is dropped rather than kept as a wrong one; other brackets are text.
  assert.deepEqual(parseNote("See [RFC 12]. [class: secret]"), { description: "See [RFC 12].", tags: [] });
  // What would close an annotation early is flattened.
  assert.equal(
    formatNote({ description: "one", owner: "a]b\nc", tags: ["x,y", ""] }),
    "one [owner: a b c] [tags: x,y]",
  );
});

test("the annotations survive the DBML round trip", () => {
  const back = toProject(parseDbml(projectToDbml(project)), "Shop");
  const customers = back.tables.find((table) => table.name === "customers")!;
  assert.deepEqual(parseNote(customers.note), parseNote(project.tables[1].note));
  assert.deepEqual(parseNote(customers.fields.find((field) => field.name === "email")!.note), {
    description: "",
    classification: "personal",
    tags: ["contact"],
  });
});

test("the dictionary lists tables by name with what each column is", () => {
  const dictionary = buildDictionary(project);
  assert.deepEqual(
    dictionary.tables.map((table) => table.name),
    ["customers", "orders"],
  );
  const [customers, orders] = dictionary.tables;
  assert.equal(customers.owner, "crm-team");
  assert.deepEqual(customers.columns[1].constraints, ["unique"]);
  assert.deepEqual(orders.columns[1].constraints, ["not null", "fk → customers.id"]);
  // The linter's instruction is not a description.
  assert.equal(orders.description, "");
  assert.deepEqual(dictionary.completeness, { tables: 2, describedTables: 1, columns: 4, describedColumns: 1 });
  assert.equal(completenessPercent(dictionary), 33);
  assert.equal(completenessPercent(buildDictionary({ ...project, tables: [], refs: [] })), 100);
});

test("a note that is only annotations does not count as a description for the linter", () => {
  const only = { ...project, tables: [{ ...project.tables[1], note: "[owner: crm-team]" }], refs: [] };
  assert.ok(lintProject(only).some((finding) => finding.ruleId === "table-description"));
  const described = { ...only, tables: [{ ...only.tables[0], note: "Accounts. [owner: crm-team]" }] };
  assert.ok(!lintProject(described).some((finding) => finding.ruleId === "table-description"));
});

test("exports: Markdown, CSV and a self-contained HTML page", () => {
  const dictionary = buildDictionary({
    ...project,
    tables: [
      { ...project.tables[1], fields: [{ id: "c1", name: "id", type: "integer", pk: true, note: "=1+1 | <b>x</b>" }] },
    ],
    refs: [],
  });

  const markdown = dictionaryToMarkdown(dictionary);
  assert.match(markdown, /^# Shop — data dictionary/);
  assert.match(markdown, /\*\*Owner:\*\* crm-team · \*\*Classification:\*\* personal · \*\*Tags:\*\* rgpd, core/);
  // A pipe in a column's description must not split the table row.
  assert.ok(markdown.includes("| `id` | integer | pk |  | =1+1 \\| <b>x</b> |"), markdown);

  const csv = dictionaryToCsv(dictionary).split("\r\n");
  assert.equal(csv[0], "table,column,type,constraints,description,owner,classification,tags");
  assert.equal(csv[1], "customers,,,,People who bought | once.,crm-team,personal,rgpd core");
  // A description that looks like a formula is defused.
  assert.equal(csv[2], "customers,id,integer,pk,'=1+1 | <b>x</b>,,,");

  const html = dictionaryToHtml(dictionary);
  assert.ok(html.includes("=1+1 | &lt;b&gt;x&lt;/b&gt;"), "markup in a description is text");
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes('<span class="c c-personal">personal</span>'));
});

test("enums: what each value means and which columns take them", () => {
  const withEnums: Project = {
    ...project,
    tables: [
      {
        ...project.tables[0],
        fields: [
          ...project.tables[0].fields,
          { id: "o3", name: "status", type: "order_status", note: "Where the order is." },
          { id: "o4", name: "previous", type: "shop.order_status[]" },
        ],
      },
      project.tables[1],
    ],
    enums: [
      { id: "e2", name: "unused", values: [{ id: "v3", name: "x" }], position: { x: 0, y: 0 } },
      {
        id: "e1",
        name: "order_status",
        values: [
          { id: "v1", name: "paid", note: "Money received. | <b>" },
          { id: "v2", name: "sent" },
        ],
        position: { x: 0, y: 0 },
      },
    ],
  };
  const dictionary = buildDictionary(withEnums);
  assert.deepEqual(
    dictionary.enums.map((def) => [def.name, def.usedBy]),
    [
      ["order_status", ["orders.status", "orders.previous"]],
      ["unused", []],
    ],
  );
  assert.deepEqual(dictionary.enums[0].values, [
    { name: "paid", description: "Money received. | <b>" },
    { name: "sent", description: "" },
  ]);
  // Enums do not weigh on how much of the schema is described.
  assert.equal(dictionary.completeness.columns, 6);

  const markdown = dictionaryToMarkdown(dictionary);
  assert.ok(markdown.includes("## order_status\n\n**Used by:** `orders.status`, `orders.previous`"), markdown);
  assert.ok(markdown.includes("| `paid` | Money received. \\| <b> |"), markdown);
  const html = dictionaryToHtml(dictionary);
  assert.ok(html.includes('<section id="enum-order_status">'));
  assert.ok(html.includes("<td><code>paid</code></td><td>Money received. | &lt;b&gt;</td>"), html);
  assert.ok(!dictionaryToMarkdown(buildDictionary(project)).includes("# Enums"));
  assert.ok(!dictionaryToHtml(buildDictionary(project)).includes("Enums"));
});

test("a note is shown to a reader without the annotation syntax", () => {
  assert.equal(
    readableNote("Customer accounts. [owner: crm-team] [class: personal] [tags: rgpd, core]"),
    "Customer accounts.\ncrm-team · personal · rgpd, core",
  );
  assert.equal(readableNote("Plain note."), "Plain note.");
  assert.equal(readableNote("[class: sensitive]"), "sensitive");
  assert.equal(readableNote(""), undefined);
  assert.equal(readableNote(undefined), undefined);
});

const MULTILINE =
  "Customer accounts.\n\nUsed by:\n- billing\n  - invoices\n- support\nIt's a \\ test, 'quoted' and ''' too.";

const withNotes = (tableNote: string, fieldNote: string): Project => ({
  ...project,
  tables: [
    {
      ...project.tables[1],
      note: tableNote,
      fields: [{ id: "c1", name: "id", type: "integer", pk: true, note: fieldNote }],
    },
  ],
  refs: [],
});

test("a description may span several lines, and the annotations are found wherever they sit", () => {
  const meta = parseNote(`${MULTILINE}\n[owner: crm-team] [tags: rgpd]`);
  assert.equal(meta.description, MULTILINE);
  assert.equal(meta.owner, "crm-team");
  assert.deepEqual(meta.tags, ["rgpd"]);
  // After the text, on a line of their own, between paragraphs, or inline: same entry.
  const expected = parseNote("A\nB [owner: x]");
  assert.deepEqual(parseNote("[owner: x]\nA\nB"), expected);
  assert.deepEqual(parseNote("A\n[owner: x]\nB"), expected);
  assert.deepEqual(parseNote("A [owner: x]\nB"), expected);
  assert.equal(parseNote("A\nB\n[class: personal] [owner: x]").description, "A\nB");
  assert.deepEqual(parseNote("A\n\n[tags: a,\n b]\n\nB"), { description: "A\n\nB", tags: ["a", "b"] });
  // Text that merely looks like an annotation in the middle of a description is one: it leaves the text.
  assert.deepEqual(parseNote("Set [owner: ops] by hand.\nSee [RFC 12]."), {
    description: "Set by hand.\nSee [RFC 12].",
    owner: "ops",
    tags: [],
  });
  // The note is written with the annotations last, on their own line, and reads back the same.
  const note = formatNote(meta)!;
  assert.equal(note, `${MULTILINE}\n[owner: crm-team] [tags: rgpd]`);
  assert.deepEqual(parseNote(note), meta);
  // A single line is exactly what it was.
  assert.equal(formatNote({ description: "One  line", owner: "a", tags: [] }), "One line [owner: a]");
});

test("Windows line endings are read as line breaks", () => {
  const meta = parseNote("First.\r\nSecond.\r\n\r\n\r\nThird. [class: internal]\r\n");
  assert.equal(meta.description, "First.\nSecond.\n\nThird.");
  assert.equal(meta.classification, "internal");
});

test("a multi-line note goes through DBML text and back", () => {
  const original = withNotes(formatNote({ description: MULTILINE, owner: "crm-team", tags: [] })!, MULTILINE);
  const dbml = projectToDbml(original);
  assert.ok(dbml.includes("Note: '''Customer accounts."), dbml);
  assert.ok(dbml.includes("pk, note: '''Customer accounts."), dbml);
  const back = toProject(parseDbml(dbml), "Shop");
  assert.equal(back.tables[0].note, original.tables[0].note);
  assert.equal(back.tables[0].fields[0].note, MULTILINE);
  assert.deepEqual(parseNote(back.tables[0].note), parseNote(original.tables[0].note));
  // And once more from the text we wrote.
  assert.equal(projectToDbml(back), dbml);
  // A one-line note is still single-quoted.
  assert.ok(projectToDbml(project).includes("Note: 'People who bought | once."));
});

test("a multi-line note counts as a description for the linter", () => {
  const described = withNotes("Accounts.\n\nSecond paragraph.", "");
  assert.ok(!lintProject(described).some((finding) => finding.ruleId === "table-description"));
  // The instruction to the linter ends with its line.
  const ignored = withNotes("lint-ignore: timestamps\nAccounts.", "");
  assert.equal(buildDictionary(ignored).tables[0].description, "Accounts.");
});

test("exports keep the line breaks of a description", () => {
  const dictionary = buildDictionary({
    ...withNotes("Accounts.\r\nSecond | line.\n\nThird <b>.", 'Who:\r\n- a\n- b "c", d\n=x'),
    enums: [
      {
        id: "e1",
        name: "status",
        values: [{ id: "v1", name: "paid", note: "Settled.\nFinal." }],
        position: { x: 0, y: 0 },
      },
    ],
  });

  const markdown = dictionaryToMarkdown(dictionary);
  // Outside the table: a hard break and a blank line. Inside a cell: <br>, never a raw newline.
  assert.ok(markdown.includes("Accounts.  \nSecond | line.\n\nThird <b>."), markdown);
  assert.ok(markdown.includes('| `id` | integer | pk |  | Who:<br>- a<br>- b "c", d<br>=x |'), markdown);
  assert.ok(markdown.includes("| `paid` | Settled.<br>Final. |"), markdown);

  const csv = dictionaryToCsv(dictionary);
  assert.ok(csv.includes('customers,,,,"Accounts.\nSecond | line.\n\nThird <b>.",'), csv);
  assert.ok(csv.includes('customers,id,integer,pk,"Who:\n- a\n- b ""c"", d\n=x",'), csv);

  const html = dictionaryToHtml(dictionary);
  assert.ok(html.includes("<p>Accounts.<br>Second | line.<br><br>Third &lt;b&gt;.</p>"), html);
  assert.ok(html.includes("<td>Who:<br>- a<br>- b &quot;c&quot;, d<br>=x</td>"), html);
  assert.ok(html.includes("<td>Settled.<br>Final.</td>"), html);
});
