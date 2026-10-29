import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDictionary } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";
import { dictionaryToPdf, type DictionaryPdfLabels } from "./dictionaryPdf";

const labels: DictionaryPdfLabels = {
  title: "Boutique — dictionnaire de données",
  date: "9 oct. 2026",
  summary: "100 % décrit",
  column: "Colonne",
  type: "Type",
  constraints: "Contraintes",
  classification: "Classification",
  description: "Description",
  value: "Valeur",
  owner: "Responsable",
  tags: "Étiquettes",
  usedBy: "Utilisée par",
  enums: "Énumérations",
  classes: { public: "Public", internal: "Interne", personal: "Personnel", sensitive: "Sensible" },
};

const project = (tables: number): Project => ({
  id: "p1",
  name: "Boutique",
  tables: Array.from({ length: tables }, (_, index) => ({
    id: `t${index}`,
    name: `table_${index}`,
    note: "Clients.\nÉté → œuvre. [class: personal]",
    fields: Array.from({ length: 10 }, (_, field) => ({
      id: `f${field}`,
      name: `colonne_${field}`,
      type: "text",
      note: "Adresse électronique.\n- connexion\n- notifications",
    })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard" as const,
  })),
  refs: [],
  enums: [{ id: "e1", name: "statut", values: [{ id: "v1", name: "payé", note: "Réglée" }], position: { x: 0, y: 0 } }],
  zones: [],
  stickyNotes: [],
  tableGroups: [],
});

const pageCount = async (blob: Blob) =>
  [
    ...Buffer.from(await blob.arrayBuffer())
      .toString("latin1")
      .matchAll(/\/Type\s*\/Page\b(?!s)/g),
  ].length;

test("the dictionary is a PDF that grows by pages, not by a longer page", async () => {
  const small = await dictionaryToPdf(buildDictionary(project(1)), labels);
  assert.equal(
    Buffer.from(await small.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );
  assert.equal(await pageCount(small), 1);
  assert.ok((await pageCount(await dictionaryToPdf(buildDictionary(project(20)), labels))) > 3);
});

test("an empty schema still makes a document", async () => {
  const blob = await dictionaryToPdf(buildDictionary({ ...project(0), enums: [] }), labels);
  assert.equal(await pageCount(blob), 1);
});
