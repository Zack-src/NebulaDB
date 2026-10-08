import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  TABLE_LOCK_AUTHORITIES,
  TABLE_LOCK_LEVELS,
  TABLE_LOCK_REASON_MAX,
  readProjectFromDoc,
  writeProjectToDoc,
  type BundleGenerator,
  type BundleLock,
  type BundleSeed,
  type Project,
  type ProjectBundle,
  type TableLockAuthority,
  type TableLockLevel,
} from "@nebuladb/shared";
import { projectToDbml } from "@nebuladb/dbml-engine";
import { getRoom, notifyLocksChanged, notifyProject } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { getGeneratorConfig, parseGeneratorConfig, saveGeneratorConfig } from "../generator/repository.js";
import { listSeedsWithContent, parseSeedInput, upsertSeed } from "../seeds/repository.js";
import { assertLocksAllow, canOverrideLock, lockAuthorityOf } from "../tableLocks/access.js";
import { getTableLock, listTableLocks, upsertTableLock } from "../tableLocks/repository.js";

interface Caller {
  id: string;
  displayName: string;
}

/** Every part of the project in one document — see `ProjectBundle`. Read from the live room, like the other exports. */
export function buildBundle(project: Project): ProjectBundle {
  const projectId = project.id;
  const tableIds = new Set(project.tables.map((table) => table.id));
  const names = new Map(project.tables.map((table) => [table.id, table.name]));

  // Only what still belongs to a table of the project: a lock or seed left
  // behind by a deleted table would import as an orphan.
  const locks: BundleLock[] = listTableLocks(projectId)
    .filter((lock) => tableIds.has(lock.tableId))
    .map((lock) => ({
      tableId: lock.tableId,
      tableName: names.get(lock.tableId) ?? lock.tableName,
      level: lock.level,
      authority: lock.authority,
      reason: lock.reason,
      lockedByName: lock.lockedByName,
      lockedAt: lock.lockedAt,
    }));
  const seeds: BundleSeed[] = listSeedsWithContent(projectId)
    .filter((seed) => tableIds.has(seed.tableId))
    .map((seed) => ({
      tableId: seed.tableId,
      tableName: names.get(seed.tableId) ?? seed.tableName,
      options: seed.options,
      content: seed.content,
    }));
  const generators: BundleGenerator[] = project.tables.flatMap((table) => {
    const config = getGeneratorConfig(projectId, table.id);
    return config ? [{ tableId: table.id, config }] : [];
  });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    dbml: projectToDbml(project, { includeVisualMetadata: true }),
    locks,
    seeds,
    generators,
  };
}

export interface BundleImportResult {
  tables: number;
  locks: number;
  seeds: number;
  generators: number;
  /** Locks and seeds left alone because the importer's authority does not reach them. */
  skipped: string[];
}

function parseLock(raw: BundleLock): { level: TableLockLevel; authority: TableLockAuthority; reason: string | null } {
  if (!TABLE_LOCK_LEVELS.includes(raw?.level) || !TABLE_LOCK_AUTHORITIES.includes(raw?.authority)) {
    throw new ApiError("TABLE_LOCK_INVALID");
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, TABLE_LOCK_REASON_MAX) : "";
  return { level: raw.level, authority: raw.authority, reason: reason || null };
}

/**
 * Restores a bundle onto a project. The schema replaces the current one
 * (ids kept, so every part below still points at the right table); then locks,
 * seeds and generator settings are set for the tables that exist.
 *
 * Nothing is written until the whole bundle has been checked — a bad seed
 * must not leave a half-restored project. Parts the importer may not touch
 * (a lock above their authority, the seed of a table under a `full` lock) are
 * skipped and reported rather than refusing everything.
 */
export function applyBundle(user: Caller, project: { id: string; name: string }, bundle: ProjectBundle): BundleImportResult {
  const projectId = project.id;
  const room = getRoom(projectId);
  const current = readProjectFromDoc(room.doc, projectId, project.name);
  // The bundle may come from another project: this one keeps its own identity.
  const incoming: Project = { ...bundle.project, id: projectId, name: current.name };
  const tableIds = new Set(incoming.tables.map((table) => table.id));

  const locks = bundle.locks.filter((lock) => tableIds.has(lock?.tableId)).map((lock) => ({ lock, ...parseLock(lock) }));
  const seeds = bundle.seeds
    .filter((seed) => tableIds.has(seed?.tableId))
    .map((seed) => ({ seed, ...parseSeedInput(seed) }));
  const generators = bundle.generators
    .filter((generator) => tableIds.has(generator?.tableId))
    .map((generator) => ({ tableId: generator.tableId, config: parseGeneratorConfig(generator.config) }));

  assertLocksAllow(user.id, projectId, current, incoming);
  room.doc.transact(() => writeProjectToDoc(room.doc, incoming), user.displayName);

  const held = lockAuthorityOf(user.id, projectId);
  const result: BundleImportResult = { tables: incoming.tables.length, locks: 0, seeds: 0, generators: 0, skipped: [] };
  const tableName = (id: string) => incoming.tables.find((table) => table.id === id)?.name ?? id;

  for (const { lock, level, authority, reason } of locks) {
    const existing = getTableLock(projectId, lock.tableId);
    // Same rules as placing a lock by hand: no lock above one's authority,
    // and none over a lock one cannot lift.
    if (!held || (authority === "instance" && held !== "instance") || (existing && !canOverrideLock(held, existing))) {
      result.skipped.push(`lock:${tableName(lock.tableId)}`);
      continue;
    }
    upsertTableLock({
      projectId,
      tableId: lock.tableId,
      tableName: tableName(lock.tableId),
      level,
      authority,
      reason,
      lockedBy: user.id,
      lockedByName: user.displayName,
    });
    result.locks++;
  }

  // Read after the locks above: a `full` lock just placed freezes its seed too.
  for (const { seed, content, options, rowCount } of seeds) {
    const lock = getTableLock(projectId, seed.tableId);
    if (lock?.level === "full" && !canOverrideLock(held, lock)) {
      result.skipped.push(`seed:${tableName(seed.tableId)}`);
      continue;
    }
    upsertSeed({
      projectId,
      tableId: seed.tableId,
      tableName: tableName(seed.tableId),
      content,
      options,
      rowCount,
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    result.seeds++;
  }

  for (const { tableId, config } of generators) {
    saveGeneratorConfig(projectId, tableId, config, user.displayName);
    result.generators++;
  }

  if (result.locks > 0) notifyLocksChanged(projectId);
  if (result.seeds > 0) notifyProject(projectId, { type: "seeds-changed" });
  return result;
}
