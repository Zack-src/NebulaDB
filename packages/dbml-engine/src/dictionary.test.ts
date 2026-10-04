import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@athanordb/shared";
import {
  buildDictionary,
  completenessPercent,
  dictionaryToCsv,
  dictionaryToHtml,
  dictionaryToMarkdown,
  formatNote,
  parseNote,
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
    { id: "r1", from: { tableId: "t2", fieldId: "o2" }, to: { tableId: "t1", fieldId: "c1" }, cardinality: "one-to-many" },
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
  // What would break the one-line note, or close an annotation early, is flattened.
  assert.equal(
    formatNote({ description: "two\nlines", owner: "a]b", tags: ["x,y", ""] }),
    "two lines [owner: a b] [tags: x,y]",
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
      { ...project.tables[1], fields: [{ id: "c1", name: "id", type: "integer", pk: true, note: "=1+1 <b>x</b>" }] },
    ],
    refs: [],
  });

  const markdown = dictionaryToMarkdown(dictionary);
  assert.match(markdown, /^# Shop — data dictionary/);
  assert.match(markdown, /\*\*Owner:\*\* crm-team · \*\*Classification:\*\* personal · \*\*Tags:\*\* rgpd, core/);
  // A pipe in a description must not split the table row.
  assert.ok(!markdown.includes("bought | once") || markdown.includes("People who bought | once.\n"));
  assert.match(markdown, /\| `id` \| integer \| pk \|  \| =1\+1 <b>x<\/b> \|/);

  const csv = dictionaryToCsv(dictionary).split("\r\n");
  assert.equal(csv[0], "table,column,type,constraints,description,owner,classification,tags");
  assert.equal(csv[1], "customers,,,,People who bought | once.,crm-team,personal,rgpd core");
  // A description that looks like a formula is defused.
  assert.equal(csv[2], "customers,id,integer,pk,'=1+1 <b>x</b>,,,");

  const html = dictionaryToHtml(dictionary);
  assert.ok(html.includes("=1+1 &lt;b&gt;x&lt;/b&gt;"), "markup in a description is text");
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes('<span class="c c-personal">personal</span>'));
});
