import type { Field, MigrationResolutionMap, Table, TableIndex } from "@nebuladb/shared";
import { translateType } from "@nebuladb/shared";
import { chosenRenames } from "./renameDetection.js";
import type { MigrationDiff, MigrationTableChange } from "./migrationDiff.js";

/**
 * The migration of a MongoDB database: not SQL, but one database command per line, as the server takes it
 * (`{"create": "users", "validator": …}`). A line starting with `--` is a comment. The driver reads them back
 * with `JSON.parse` and runs each through `db.command`.
 *
 * A table is a collection. Its columns become a `$jsonSchema` validator — the type each column was written with
 * is kept in the property's `description`, so that reading the collection back gives the same type, not the
 * BSON one it was translated to. A primary key and a unique column become unique indexes (`pk_<table>`,
 * `uq_<table>_<column>`). MongoDB has no foreign key, no default and no identity column.
 */

/** The `bsonType` names a `$jsonSchema` validator takes, and that `translateType(…, "mongodb")` can produce. */
const BSON_TYPES = new Set([
  "int",
  "long",
  "double",
  "decimal",
  "bool",
  "string",
  "date",
  "binData",
  "object",
  "array",
]);

function bsonTypeOf(field: Field): string | undefined {
  const translated = translateType((field.type || "text").replace(/\((\d+)\.(\d+)\)/, "($1,$2)"), "mongodb").type;
  // A BSON type takes no size: `decimal(10,2)` is already native, and stays spelled with its precision.
  const base = translated
    .replace(/\s*\(.*$/, "")
    .trim()
    .toLowerCase();
  return [...BSON_TYPES].find((type) => type.toLowerCase() === base);
}

const isRequired = (field: Field) => Boolean(field.notNull || field.pk);

/** The `$jsonSchema` validator of a collection: what MongoDB checks on every write. */
export function mongoValidator(table: Table): { $jsonSchema: Record<string, unknown> } {
  const properties: Record<string, unknown> = {};
  for (const field of table.fields) {
    const bson = bsonTypeOf(field);
    properties[field.name] = {
      ...(bson ? { bsonType: isRequired(field) ? bson : [bson, "null"] } : {}),
      description: field.type || "text",
    };
  }
  const required = table.fields.filter(isRequired).map((field) => field.name);
  return {
    $jsonSchema: { bsonType: "object", ...(required.length > 0 ? { required } : {}), properties },
  };
}

const pkIndexName = (table: string) => `pk_${table}`;
const uniqueIndexName = (table: string, column: string) => `uq_${table}_${column}`;

interface MongoIndex {
  key: Record<string, 1>;
  name: string;
  unique?: boolean;
}

function keyOf(columns: string[]): Record<string, 1> {
  return Object.fromEntries(columns.map((column) => [column, 1 as const]));
}

/** The indexes a collection is created with: its primary key, its unique columns, then the secondary ones. */
function indexesOf(table: Table): MongoIndex[] {
  const nameOf = (id: string) => table.fields.find((f) => f.id === id)?.name ?? id;
  const compositePk = table.indexes.find((i) => i.pk && i.fieldIds.length > 1);
  const pkColumns = compositePk
    ? compositePk.fieldIds.map(nameOf)
    : table.fields.filter((f) => f.pk).map((f) => f.name);
  const indexes: MongoIndex[] = [];
  if (pkColumns.length > 0) indexes.push({ key: keyOf(pkColumns), name: pkIndexName(table.name), unique: true });
  for (const field of table.fields) {
    if (field.unique && !field.pk) {
      indexes.push({ key: keyOf([field.name]), name: uniqueIndexName(table.name, field.name), unique: true });
    }
  }
  for (const index of table.indexes.filter((i) => !i.pk)) indexes.push(secondaryIndex(table, index));
  return indexes;
}

function secondaryIndex(table: Table, index: TableIndex): MongoIndex {
  const columns = index.fieldIds.map((id) => table.fields.find((f) => f.id === id)?.name ?? id);
  return {
    key: keyOf(columns),
    name: index.name || `idx_${table.name}_${columns.join("_")}`,
    ...(index.unique ? { unique: true } : {}),
  };
}

const line = (command: Record<string, unknown>) => JSON.stringify(command);

function createIndexes(collection: string, indexes: MongoIndex[]): string[] {
  return indexes.length > 0 ? [line({ createIndexes: collection, indexes })] : [];
}

function updateAll(collection: string, update: Record<string, unknown>, filter: Record<string, unknown> = {}): string {
  return line({ update: collection, updates: [{ q: filter, u: update, multi: true }] });
}

function tableStatements(
  change: MigrationTableChange,
  resolutions: MigrationResolutionMap,
  diff: MigrationDiff,
): string[] {
  const after = change.after!;
  const collection = change.name;
  const statements: string[] = [];

  const renames = chosenRenames(diff, resolutions).get(collection.toLowerCase()) ?? [];
  for (const { from, to } of renames) statements.push(updateAll(collection, { $rename: { [from]: to } }));
  const skip = new Set(
    renames.flatMap(({ from, to }) => [`dropped:${from.toLowerCase()}`, `added:${to.toLowerCase()}`]),
  );

  let validatorChanged = renames.length > 0;
  for (const field of change.fields) {
    if (skip.has(`${field.status}:${field.name.toLowerCase()}`)) continue;
    const resolution = resolutions[`column:${collection.toLowerCase()}.${field.name.toLowerCase()}`];
    if (field.status === "dropped") {
      validatorChanged = true;
      if (resolution?.strategy === "KEEP_IN_DB")
        statements.push(`-- Kept field ${collection}.${field.name} per resolution choice`);
      else statements.push(updateAll(collection, { $unset: { [field.name]: "" } }));
      continue;
    }
    validatorChanged = true;
    if (resolution?.strategy === "CLEAR_COLUMN_DATA")
      statements.push(updateAll(collection, { $set: { [field.name]: null } }));
    if (resolution?.strategy === "BACKFILL_DEFAULT" && resolution.value) {
      const value = Number.isNaN(Number(resolution.value))
        ? resolution.value.replace(/^'|'$/g, "")
        : Number(resolution.value);
      statements.push(updateAll(collection, { $set: { [field.name]: value } }, { [field.name]: null }));
    }
    if (resolution?.strategy === "DELETE_OFFENDING_ROWS") {
      statements.push(line({ delete: collection, deletes: [{ q: { [field.name]: null }, limit: 0 }] }));
    }
  }
  // The validator is stated again whole: it describes the collection as it is meant to be.
  if (validatorChanged) statements.push(line({ collMod: collection, validator: mongoValidator(after) }));

  // A primary key or a unique column that came, went or changed: its index follows.
  const dropped = new Set<string>();
  const created: MongoIndex[] = [];
  const wanted = new Map(indexesOf(after).map((index) => [index.name, index]));
  const had = new Map(indexesOf(change.before ?? after).map((index) => [index.name, index]));
  for (const [name] of had)
    if (!wanted.has(name) && (name.startsWith("pk_") || name.startsWith("uq_"))) dropped.add(name);
  for (const [name, index] of wanted)
    if (!had.has(name) && (name.startsWith("pk_") || name.startsWith("uq_"))) created.push(index);

  for (const index of change.droppedIndexes) {
    const name = index.name || secondaryIndex(change.before ?? after, index).name;
    if (!index.pk) dropped.add(name);
  }
  for (const name of dropped) statements.push(line({ dropIndexes: collection, index: name }));
  for (const index of change.addedIndexes.filter((i) => !i.pk)) created.push(secondaryIndex(after, index));
  statements.push(...createIndexes(collection, created));
  return statements;
}

/** The commands that create one collection, with its validator and its indexes. */
export function mongoCreateCollection(table: Table): string {
  return [
    line({ create: table.name, validator: mongoValidator(table) }),
    ...createIndexes(table.name, indexesOf(table)),
  ].join("\n");
}

/** The commands that turn the collections of a database into those the schema describes. */
export function generateMongoMigration(diff: MigrationDiff, resolutions: MigrationResolutionMap = {}): string {
  const statements: string[] = [];

  for (const table of diff.tables.filter((t) => t.status === "dropped")) {
    if (resolutions[`table:${table.name.toLowerCase()}`]?.strategy === "KEEP_IN_DB") {
      statements.push(`-- Kept collection ${table.name} per resolution choice`);
    } else {
      statements.push(line({ drop: table.name }));
    }
  }

  for (const table of diff.tables.filter((t) => t.status === "added" && t.after)) {
    statements.push(mongoCreateCollection(table.after!));
  }

  for (const table of diff.tables.filter((t) => t.status === "modified" && t.after)) {
    statements.push(...tableStatements(table, resolutions, diff));
  }

  return statements.join("\n");
}
