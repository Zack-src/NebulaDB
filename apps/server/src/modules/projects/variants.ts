import { readProjectFromDoc, writeProjectToDoc, type Project } from "@nebuladb/shared";
import {
  applyVariantSync,
  diffProjects,
  planVariantSync,
  replaceVariantSchema,
  variantStatus,
  type ProjectDiff,
  type VariantDecisions,
  type VariantSyncPlan,
} from "@nebuladb/dbml-engine";
import { db } from "../../infrastructure/db.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { ApiError } from "../../shared/errors.js";
import { hasPermission } from "../../shared/permissions.js";
import { lockGuardFor } from "../tableLocks/access.js";
import { applyBundle, buildBundle } from "./bundle.js";
import { createProjectForUser } from "./projectCrud.js";
import { getProjectRow } from "./repository.js";

/**
 * Client variants: a project copied from another one (its original), kept up
 * to date by sending it the original's changes when, and where, someone
 * chooses to. See `variants.ts` in the DBML engine for what is sent and what
 * counts as a conflict.
 */

interface Caller {
  id: string;
  displayName: string;
}

interface VariantRow {
  project_id: string;
  base_project_id: string;
  synced_json: string;
  synced_at: string;
  synced_by_name: string | null;
}

export interface VariantLink {
  baseProjectId: string;
  syncedAt: string;
  syncedByName: string | null;
}

export interface VariantStatus {
  /** The original's changes the variant has not received. */
  pending: number;
  /** Among them, those the client changed too. */
  conflicts: number;
  /** What the client changed since the last sending. */
  customizations: number;
}

async function variantRow(projectId: string): Promise<VariantRow | undefined> {
  return (await db.prepare("SELECT * FROM project_variants WHERE project_id = ?").get(projectId)) as
    VariantRow | undefined;
}

export async function getVariantLink(projectId: string): Promise<VariantLink | null> {
  const row = await variantRow(projectId);
  return row ? { baseProjectId: row.base_project_id, syncedAt: row.synced_at, syncedByName: row.synced_by_name } : null;
}

async function readProject(projectId: string): Promise<Project> {
  const row = await getProjectRow(projectId);
  if (!row) throw new ApiError("NOT_FOUND");
  return await readProjectReadOnly(projectId, row.name);
}

const parseSynced = (row: VariantRow): Project => JSON.parse(row.synced_json) as Project;

/**
 * A full copy of `baseId` — schema and layout, locks, seeds, generator
 * settings — as a new project of the caller's, in the same folder, tied to
 * its original. A variant has no variants of its own.
 */
export async function createVariant(
  user: Caller,
  baseId: string,
  name: unknown,
): Promise<{ id: string; name: string }> {
  if (await variantRow(baseId)) throw new ApiError("VARIANT_OF_VARIANT");
  const base = await readProject(baseId);
  const created = await createProjectForUser(user.id, name);
  const bundle = await buildBundle(base);
  await applyBundle(user, created, bundle);
  await db
    .prepare("UPDATE projects SET folder_id = (SELECT folder_id FROM projects WHERE id = ?) WHERE id = ?")
    .run(baseId, created.id);
  await db
    .prepare(
      "INSERT INTO project_variants (project_id, base_project_id, synced_json, synced_by_name) VALUES (?, ?, ?, ?)",
    )
    .run(created.id, baseId, JSON.stringify(base), user.displayName);
  return created;
}

export async function statusOf(variantId: string): Promise<VariantStatus | null> {
  const row = await variantRow(variantId);
  if (!row) return null;
  return variantStatus(parseSynced(row), await readProject(row.base_project_id), await readProject(variantId));
}

/** The variants of `baseId` the caller can open, with how far each is from the original. */
export async function listVariants(
  userId: string,
  baseId: string,
): Promise<
  {
    id: string;
    name: string;
    syncedAt: string;
    syncedByName: string | null;
    canEdit: boolean;
    /** May rename it, trash it, detach it: administrator of the variant. */
    canManage: boolean;
    status: VariantStatus;
  }[]
> {
  const rows = (await db
    .prepare(
      `SELECT v.*, p.name FROM project_variants v JOIN projects p ON p.id = v.project_id
        WHERE v.base_project_id = ? AND p.status <> 'trashed' ORDER BY p.name`,
    )
    .all(baseId)) as (VariantRow & { name: string })[];
  const base = await readProject(baseId);
  const result = [];
  for (const row of rows) {
    if (!(await hasPermission(userId, row.project_id, "view"))) continue;
    result.push({
      id: row.project_id,
      name: row.name,
      syncedAt: row.synced_at,
      syncedByName: row.synced_by_name,
      canEdit: await hasPermission(userId, row.project_id, "edit"),
      canManage: await hasPermission(userId, row.project_id, "administrator"),
      status: variantStatus(parseSynced(row), base, await readProject(row.project_id)),
    });
  }
  return result;
}

async function requireVariantOf(baseId: string, variantId: string): Promise<VariantRow> {
  const row = await variantRow(variantId);
  if (!row || row.base_project_id !== baseId) throw new ApiError("VARIANT_NOT_FOUND");
  return row;
}

/** What sending would do to each chosen variant — nothing is changed. */
export async function previewSync(
  userId: string,
  baseId: string,
  variantIds: readonly string[],
): Promise<{ id: string; name: string; plan: VariantSyncPlan }[]> {
  const base = await readProject(baseId);
  const result = [];
  for (const id of variantIds) {
    const row = await requireVariantOf(baseId, id);
    if (!(await hasPermission(userId, id, "view"))) throw new ApiError("FORBIDDEN");
    const variant = await readProject(id);
    result.push({ id, name: variant.name, plan: planVariantSync(parseSynced(row), base, variant) });
  }
  return result;
}

export interface SyncResult {
  id: string;
  name: string;
  applied: number;
  kept: number;
  error?: string;
}

/**
 * Sends the original's changes to each chosen variant, as each one's
 * decisions say. Every variant is its own write: one refused (no right to
 * edit it, a locked table) does not stop the others. Afterwards the variant
 * counts as up to date with the original — what was not taken stays the
 * client's own and does not come back next time.
 */
export async function pushToVariants(
  user: Caller,
  baseId: string,
  targets: readonly { id: string; decisions?: VariantDecisions }[],
): Promise<SyncResult[]> {
  const base = await readProject(baseId);
  const results: SyncResult[] = [];
  for (const target of targets) {
    const row = await requireVariantOf(baseId, target.id);
    const name = (await getProjectRow(target.id))?.name ?? target.id;
    if (!(await hasPermission(user.id, target.id, "edit"))) {
      results.push({ id: target.id, name, applied: 0, kept: 0, error: "FORBIDDEN" });
      continue;
    }
    const synced = parseSynced(row);
    try {
      const assertLocksAllow = await lockGuardFor(user.id, target.id);
      // From here to `room.write`, nothing waits: see `Room.write`.
      const room = await getRoom(target.id);
      const current = readProjectFromDoc(room.doc, target.id, name);
      const decisions = target.decisions ?? {};
      const plan = planVariantSync(synced, base, current);
      const next = applyVariantSync(synced, base, current, decisions);
      assertLocksAllow(current, next);
      const applied = plan.changes.filter(
        (c) => (decisions[c.key] ?? (c.conflict ? "variant" : "base")) === "base",
      ).length;
      if (applied > 0) await room.write(() => writeProjectToDoc(room.doc, next), user.displayName);
      await db
        .prepare(
          "UPDATE project_variants SET synced_json = ?, synced_at = utc_now(), synced_by_name = ? WHERE project_id = ?",
        )
        .run(JSON.stringify(base), user.displayName, target.id);
      results.push({ id: target.id, name, applied, kept: plan.changes.length - applied });
    } catch (err) {
      results.push({
        id: target.id,
        name,
        applied: 0,
        kept: 0,
        error: err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** The variant becomes a project of its own: it no longer receives anything from its original. */
export async function detachVariant(variantId: string): Promise<boolean> {
  return (await db.prepare("DELETE FROM project_variants WHERE project_id = ?").run(variantId)).changes > 0;
}

/** Two projects side by side, matched by id: what `to` has that `from` has not, and the other way round. */
export async function compareProjects(fromId: string, toId: string): Promise<ProjectDiff> {
  return diffProjects(await readProject(fromId), await readProject(toId));
}

/**
 * Puts a variant back to its original's schema (`from: "original"`), or to
 * another variant's of the same original. What the variant had of its own is
 * gone (the history keeps it). After a reset the variant is up to date with
 * the original; after a copy it stands exactly where the copied variant does,
 * including what that one has not received yet.
 */
export async function resetVariant(user: Caller, variantId: string, from: string): Promise<{ from: string }> {
  const row = await variantRow(variantId);
  if (!row) throw new ApiError("VARIANT_NOT_FOUND");
  let source: Project;
  let synced: Project;
  if (from === "original") {
    if (!(await hasPermission(user.id, row.base_project_id, "view"))) throw new ApiError("FORBIDDEN");
    source = await readProject(row.base_project_id);
    synced = source;
  } else {
    const other = await variantRow(from);
    if (!other || other.base_project_id !== row.base_project_id || from === variantId)
      throw new ApiError("VARIANT_NOT_FOUND");
    if (!(await hasPermission(user.id, from, "view"))) throw new ApiError("FORBIDDEN");
    source = await readProject(from);
    synced = parseSynced(other);
  }
  const name = (await getProjectRow(variantId))?.name ?? variantId;
  const assertLocksAllow = await lockGuardFor(user.id, variantId);
  // From here to `room.write`, nothing waits: see `Room.write`.
  const room = await getRoom(variantId);
  const current = readProjectFromDoc(room.doc, variantId, name);
  const next = replaceVariantSchema(current, source);
  assertLocksAllow(current, next);
  await room.write(() => writeProjectToDoc(room.doc, next), user.displayName);
  await db
    .prepare(
      "UPDATE project_variants SET synced_json = ?, synced_at = utc_now(), synced_by_name = ? WHERE project_id = ?",
    )
    .run(JSON.stringify(synced), user.displayName, variantId);
  return { from };
}

/**
 * The original and its variants, names only, as far as the caller may see
 * them — what the project header switches between. `null` for a project that
 * is neither an original with variants nor a variant.
 */
export async function familyOf(
  userId: string,
  projectId: string,
): Promise<{ originalId: string; members: { id: string; name: string; original: boolean }[] } | null> {
  const originalId = (await variantRow(projectId))?.base_project_id ?? projectId;
  const rows = (await db
    .prepare(
      `SELECT p.id, p.name FROM project_variants v JOIN projects p ON p.id = v.project_id
        WHERE v.base_project_id = ? AND p.status <> 'trashed' ORDER BY p.name`,
    )
    .all(originalId)) as { id: string; name: string }[];
  if (rows.length === 0) return null;
  const members: { id: string; name: string; original: boolean }[] = [];
  const original = await getProjectRow(originalId);
  if (original && (await hasPermission(userId, originalId, "view")))
    members.push({ id: originalId, name: original.name, original: true });
  for (const row of rows) {
    if (row.id === projectId || (await hasPermission(userId, row.id, "view")))
      members.push({ id: row.id, name: row.name, original: false });
  }
  return { originalId, members };
}
