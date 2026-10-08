import type { Project } from "./schema.js";
import type { TableGeneratorConfig } from "./dataGenerator.js";
import type { SeedOptions } from "./seeds.js";
import type { TableLockAuthority, TableLockLevel } from "./tableLocks.js";

/**
 * The project bundle: everything NebulaDB knows about a project in one JSON
 * file. DBML carries the schema and its canvas layout; the bundle adds what
 * DBML cannot say — table locks, initial data (seeds), data-generator settings,
 * comments, the colour palette — and keeps the ids that tie them together.
 *
 * Everything is keyed by **table id**, as in the app itself; `project` is the
 * authority on import, `dbml` only a readable copy of it.
 */
export const BUNDLE_FORMAT = "nebuladb.project";
export const BUNDLE_VERSION = 1;

export interface BundleLock {
  tableId: string;
  tableName: string;
  level: TableLockLevel;
  authority: TableLockAuthority;
  reason: string | null;
  lockedByName: string | null;
  lockedAt: string;
}

export interface BundleSeed {
  tableId: string;
  tableName: string;
  options: SeedOptions;
  /** The CSV file itself. */
  content: string;
}

export interface BundleGenerator {
  tableId: string;
  config: TableGeneratorConfig;
}

export interface ProjectBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: string;
  /** Tables (position, size, colour, detail level, comments), relations, enums, zones, notes, groups, palette. */
  project: Project;
  /** The same schema as DBML with its visual metadata — for reading and diffing; ignored on import. */
  dbml: string;
  locks: BundleLock[];
  seeds: BundleSeed[];
  generators: BundleGenerator[];
}

/** Whether a text looks like a bundle — cheap enough to ask of any pasted import before choosing a path. */
export function looksLikeProjectBundle(text: string): boolean {
  return text.trimStart().startsWith("{") && text.includes(`"${BUNDLE_FORMAT}"`);
}

function list<T>(value: unknown, name: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`bundle: "${name}" must be a list`);
  return value as T[];
}

/**
 * Parses and shape-checks a bundle. Deeper checks (seed CSV, generator
 * settings, lock values) belong to the code that stores each part, which
 * already has them. Missing optional parts read as empty, so an older or
 * hand-trimmed bundle still imports.
 */
export function parseProjectBundle(text: string): ProjectBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("bundle: not valid JSON");
  }
  const bundle = (raw ?? {}) as Record<string, unknown>;
  if (bundle.format !== BUNDLE_FORMAT) throw new Error("bundle: not a NebulaDB project bundle");
  if (typeof bundle.version !== "number" || bundle.version < 1 || bundle.version > BUNDLE_VERSION) {
    throw new Error(`bundle: unsupported version ${String(bundle.version)} (this build reads up to ${BUNDLE_VERSION})`);
  }
  const project = (bundle.project ?? {}) as Partial<Project>;
  if (typeof project !== "object" || !Array.isArray(project.tables) || !Array.isArray(project.refs)) {
    throw new Error('bundle: "project" needs tables and refs');
  }
  return {
    format: BUNDLE_FORMAT,
    version: bundle.version,
    exportedAt: typeof bundle.exportedAt === "string" ? bundle.exportedAt : "",
    project: {
      id: typeof project.id === "string" ? project.id : "",
      name: typeof project.name === "string" ? project.name : "",
      tables: project.tables,
      refs: project.refs,
      enums: list(project.enums, "project.enums"),
      zones: list(project.zones, "project.zones"),
      stickyNotes: list(project.stickyNotes, "project.stickyNotes"),
      tableGroups: list(project.tableGroups, "project.tableGroups"),
      ...(Array.isArray(project.paletteColors) ? { paletteColors: project.paletteColors } : {}),
    },
    dbml: typeof bundle.dbml === "string" ? bundle.dbml : "",
    locks: list(bundle.locks, "locks"),
    seeds: list(bundle.seeds, "seeds"),
    generators: list(bundle.generators, "generators"),
  };
}
