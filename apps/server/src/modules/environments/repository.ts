import crypto from "node:crypto";
import {
  ENVIRONMENT_COLORS,
  ENVIRONMENT_NAME_MAX,
  ENVIRONMENT_PROTECTIONS,
  type EnvironmentColor,
  type EnvironmentProtection,
  type EnvironmentStage,
  type EnvironmentStageInput,
} from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

interface EnvironmentRow {
  id: string;
  name: string;
  color: string;
  protection: string;
  is_production: number;
  position: number;
  connection_count: number;
}

const SELECT_STAGES = `
  SELECT e.*, (SELECT COUNT(*) FROM db_connections c WHERE c.environment_id = e.id) AS connection_count
    FROM environments e`;

function rowToStage(row: EnvironmentRow): EnvironmentStage {
  return {
    id: row.id,
    name: row.name,
    color: row.color as EnvironmentColor,
    protection: row.protection as EnvironmentProtection,
    production: row.is_production === 1,
    position: row.position,
    connectionCount: row.connection_count,
  };
}

/** The instance's chain, in order. */
export function listEnvironments(): EnvironmentStage[] {
  return (db.prepare(`${SELECT_STAGES} ORDER BY e.position, e.name`).all() as EnvironmentRow[]).map(rowToStage);
}

export function getEnvironment(id: string): EnvironmentStage | null {
  const row = db.prepare(`${SELECT_STAGES} WHERE e.id = ?`).get(id) as EnvironmentRow | undefined;
  return row ? rowToStage(row) : null;
}

/** A stage by its name, ignoring case and surrounding spaces — how a free-text `environment` sent by an older client is resolved. */
export function findEnvironmentByName(name: string): EnvironmentStage | null {
  const row = db.prepare(`${SELECT_STAGES} WHERE e.name = ? COLLATE NOCASE`).get(name.trim()) as
    EnvironmentRow | undefined;
  return row ? rowToStage(row) : null;
}

/** Validates what an administrator sent; `partial` for an update, where every field is optional. */
function parseInput(body: unknown, partial: boolean): EnvironmentStageInput {
  if (!body || typeof body !== "object") throw new ApiError("ENVIRONMENT_INVALID");
  const raw = body as Record<string, unknown>;
  const input: EnvironmentStageInput = {};
  if (raw.name !== undefined || !partial) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > ENVIRONMENT_NAME_MAX) throw new ApiError("ENVIRONMENT_INVALID");
    input.name = name;
  }
  if (raw.color !== undefined) {
    if (!ENVIRONMENT_COLORS.includes(raw.color as EnvironmentColor)) throw new ApiError("ENVIRONMENT_INVALID");
    input.color = raw.color as EnvironmentColor;
  }
  if (raw.protection !== undefined) {
    if (!ENVIRONMENT_PROTECTIONS.includes(raw.protection as EnvironmentProtection)) {
      throw new ApiError("ENVIRONMENT_INVALID");
    }
    input.protection = raw.protection as EnvironmentProtection;
  }
  if (raw.production !== undefined) {
    if (typeof raw.production !== "boolean") throw new ApiError("ENVIRONMENT_INVALID");
    input.production = raw.production;
  }
  return input;
}

function assertNameFree(name: string, exceptId?: string): void {
  const existing = findEnvironmentByName(name);
  if (existing && existing.id !== exceptId) throw new ApiError("ENVIRONMENT_NAME_TAKEN");
}

/** At most one production stage: flagging one takes the flag off the other. */
function takeProductionFlag(id: string): void {
  db.prepare("UPDATE environments SET is_production = 0 WHERE is_production = 1 AND id <> ?").run(id);
  db.prepare("UPDATE environments SET is_production = 1, protection = 'protected' WHERE id = ?").run(id);
}

/** Appends a stage at the end of the chain. */
export function createEnvironment(body: unknown): EnvironmentStage {
  const input = parseInput(body, false);
  assertNameFree(input.name!);
  const id = crypto.randomUUID();
  db.transaction(() => {
    const { next } = db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM environments").get() as {
      next: number;
    };
    db.prepare("INSERT INTO environments (id, name, color, protection, position) VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.name!,
      input.color ?? (input.production ? "red" : "blue"),
      input.protection ?? "free",
      next,
    );
    if (input.production) takeProductionFlag(id);
  })();
  return getEnvironment(id)!;
}

/**
 * Renames, recolours, changes protection, or moves the production flag.
 * A rename is carried to every connection on the stage, whose `environment`
 * column is the name history and webhooks read.
 */
export function updateEnvironment(id: string, body: unknown): { before: EnvironmentStage; after: EnvironmentStage } {
  const before = getEnvironment(id);
  if (!before) throw new ApiError("ENVIRONMENT_NOT_FOUND");
  const input = parseInput(body, true);
  if (input.name) assertNameFree(input.name, id);
  db.transaction(() => {
    db.prepare("UPDATE environments SET name = ?, color = ?, protection = ? WHERE id = ?").run(
      input.name ?? before.name,
      input.color ?? before.color,
      input.protection ?? before.protection,
      id,
    );
    if (input.name && input.name !== before.name) {
      db.prepare("UPDATE db_connections SET environment = ? WHERE environment_id = ?").run(input.name, id);
    }
    if (input.production === true) takeProductionFlag(id);
    else if (input.production === false) db.prepare("UPDATE environments SET is_production = 0 WHERE id = ?").run(id);
  })();
  return { before, after: getEnvironment(id)! };
}

/** Removes a stage; its connections are left without one (and say so), never deleted. */
export function deleteEnvironment(id: string): EnvironmentStage {
  const existing = getEnvironment(id);
  if (!existing) throw new ApiError("ENVIRONMENT_NOT_FOUND");
  db.transaction(() => {
    db.prepare("UPDATE db_connections SET environment_id = NULL, environment = NULL WHERE environment_id = ?").run(id);
    db.prepare("DELETE FROM environments WHERE id = ?").run(id);
    renumber(listEnvironments().map((stage) => stage.id));
  })();
  return existing;
}

function renumber(ids: readonly string[]): void {
  const update = db.prepare("UPDATE environments SET position = ? WHERE id = ?");
  ids.forEach((stageId, position) => update.run(position, stageId));
}

/** Sets the chain's order. `ids` must name every stage exactly once. */
export function reorderEnvironments(ids: unknown): EnvironmentStage[] {
  const current = listEnvironments().map((stage) => stage.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((stageId) => typeof stageId === "string" && current.includes(stageId))
  ) {
    throw new ApiError("ENVIRONMENT_INVALID");
  }
  db.transaction(() => renumber(ids as string[]))();
  return listEnvironments();
}

/**
 * The stage a connection write names: `environmentId` (a stage id, or
 * `null`/`""` for none) wins; otherwise a name in `environment`, which must be
 * an existing stage — the free-text label is gone, and inventing a stage from
 * whatever a client typed would undo the administrator's chain. `undefined`
 * means "not part of this write".
 */
export function resolveConnectionEnvironment(input: {
  environmentId?: unknown;
  environment?: unknown;
}): { id: string; name: string } | null | undefined {
  if (input.environmentId !== undefined) {
    if (input.environmentId === null || input.environmentId === "") return null;
    if (typeof input.environmentId !== "string") throw new ApiError("ENVIRONMENT_NOT_FOUND");
    const stage = getEnvironment(input.environmentId);
    if (!stage) throw new ApiError("ENVIRONMENT_NOT_FOUND");
    return { id: stage.id, name: stage.name };
  }
  if (input.environment !== undefined) {
    if (input.environment === null || (typeof input.environment === "string" && !input.environment.trim())) return null;
    if (typeof input.environment !== "string") throw new ApiError("ENVIRONMENT_NOT_FOUND");
    const stage = findEnvironmentByName(input.environment);
    if (!stage)
      throw new ApiError("ENVIRONMENT_NOT_FOUND", { details: { known: listEnvironments().map((s) => s.name) } });
    return { id: stage.id, name: stage.name };
  }
  return undefined;
}
