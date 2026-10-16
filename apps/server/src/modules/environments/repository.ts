import crypto from "node:crypto";
import {
  ENVIRONMENT_COLORS,
  ENVIRONMENT_NAME_MAX,
  ENVIRONMENT_PROTECTIONS,
  type EnvironmentColor,
  type EnvironmentProtection,
  type EnvironmentStage,
  type EnvironmentStageInput,
} from "@nebuladb/shared";
import { parseVariableValues } from "@nebuladb/dbml-engine";
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
  variables_json: string;
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
    variables: JSON.parse(row.variables_json) as Record<string, string>,
  };
}

/** The instance's chain, in order. */
export async function listEnvironments(): Promise<EnvironmentStage[]> {
  return ((await db.prepare(`${SELECT_STAGES} ORDER BY e.position, e.name`).all()) as EnvironmentRow[]).map(rowToStage);
}

export async function getEnvironment(id: string): Promise<EnvironmentStage | null> {
  const row = (await db.prepare(`${SELECT_STAGES} WHERE e.id = ?`).get(id)) as EnvironmentRow | undefined;
  return row ? rowToStage(row) : null;
}

/** A stage by its name, ignoring case and surrounding spaces — how a free-text `environment` sent by an older client is resolved. */
async function findEnvironmentByName(name: string): Promise<EnvironmentStage | null> {
  const row = (await db.prepare(`${SELECT_STAGES} WHERE LOWER(e.name) = LOWER(?)`).get(name.trim())) as
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
  if (raw.variables !== undefined) {
    const variables = parseVariableValues(raw.variables);
    if (!variables) throw new ApiError("ENVIRONMENT_INVALID");
    input.variables = variables;
  }
  return input;
}

async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const existing = await findEnvironmentByName(name);
  if (existing && existing.id !== exceptId) throw new ApiError("ENVIRONMENT_NAME_TAKEN");
}

/**
 * Makes the transaction it is called in the only one changing the chain until
 * it ends. A stage's name must be free, its position the next one, the
 * production flag on one stage only: each is read and then written, and two
 * administrators saving at once would both read the same "before". Readers
 * are not held up.
 */
async function lockChain(): Promise<void> {
  await db.exec("LOCK TABLE environments IN SHARE ROW EXCLUSIVE MODE");
}

/** At most one production stage: flagging one takes the flag off the other. */
async function takeProductionFlag(id: string): Promise<void> {
  await db.prepare("UPDATE environments SET is_production = 0 WHERE is_production = 1 AND id <> ?").run(id);
  await db.prepare("UPDATE environments SET is_production = 1, protection = 'protected' WHERE id = ?").run(id);
}

/** Appends a stage at the end of the chain. */
export async function createEnvironment(body: unknown): Promise<EnvironmentStage> {
  const input = parseInput(body, false);
  const id = crypto.randomUUID();
  await db.transaction(async () => {
    await lockChain();
    await assertNameFree(input.name!);
    const { next } = (await db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM environments").get()) as {
      next: number;
    };
    await db
      .prepare(
        "INSERT INTO environments (id, name, color, protection, position, variables_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.name!,
        input.color ?? (input.production ? "red" : "blue"),
        input.protection ?? "free",
        next,
        JSON.stringify(input.variables ?? {}),
      );
    if (input.production) await takeProductionFlag(id);
  });
  return (await getEnvironment(id))!;
}

/**
 * Renames, recolours, changes protection, or moves the production flag.
 * A rename is carried to every connection on the stage, whose `environment`
 * column is the name history and webhooks read.
 */
export async function updateEnvironment(
  id: string,
  body: unknown,
): Promise<{ before: EnvironmentStage; after: EnvironmentStage }> {
  const input = parseInput(body, true);
  const before = await db.transaction(async () => {
    await lockChain();
    const before = await getEnvironment(id);
    if (!before) throw new ApiError("ENVIRONMENT_NOT_FOUND");
    if (input.name) await assertNameFree(input.name, id);
    await db
      .prepare("UPDATE environments SET name = ?, color = ?, protection = ?, variables_json = ? WHERE id = ?")
      .run(
        input.name ?? before.name,
        input.color ?? before.color,
        input.protection ?? before.protection,
        JSON.stringify(input.variables ?? before.variables),
        id,
      );
    if (input.name && input.name !== before.name) {
      await db.prepare("UPDATE db_connections SET environment = ? WHERE environment_id = ?").run(input.name, id);
    }
    if (input.production === true) await takeProductionFlag(id);
    else if (input.production === false)
      await db.prepare("UPDATE environments SET is_production = 0 WHERE id = ?").run(id);
    return before;
  });
  return { before, after: (await getEnvironment(id))! };
}

/** Removes a stage; its connections are left without one (and say so), never deleted. */
export async function deleteEnvironment(id: string): Promise<EnvironmentStage> {
  return db.transaction(async () => {
    await lockChain();
    const existing = await getEnvironment(id);
    if (!existing) throw new ApiError("ENVIRONMENT_NOT_FOUND");
    await db
      .prepare("UPDATE db_connections SET environment_id = NULL, environment = NULL WHERE environment_id = ?")
      .run(id);
    await db.prepare("DELETE FROM environments WHERE id = ?").run(id);
    await renumber((await listEnvironments()).map((stage) => stage.id));
    return existing;
  });
}

async function renumber(ids: readonly string[]): Promise<void> {
  const update = db.prepare("UPDATE environments SET position = ? WHERE id = ?");
  for (const [position, stageId] of ids.entries()) await update.run(position, stageId);
}

/** Sets the chain's order. `ids` must name every stage exactly once. */
export async function reorderEnvironments(ids: unknown): Promise<EnvironmentStage[]> {
  await db.transaction(async () => {
    await lockChain();
    const current = (await listEnvironments()).map((stage) => stage.id);
    if (
      !Array.isArray(ids) ||
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      !ids.every((stageId) => typeof stageId === "string" && current.includes(stageId))
    ) {
      throw new ApiError("ENVIRONMENT_INVALID");
    }
    await renumber(ids as string[]);
  });
  return await listEnvironments();
}

/**
 * The stage a connection write names: `environmentId` (a stage id, or
 * `null`/`""` for none) wins; otherwise a name in `environment`, which must be
 * an existing stage — the free-text label is gone, and inventing a stage from
 * whatever a client typed would undo the administrator's chain. `undefined`
 * means "not part of this write".
 */
export async function resolveConnectionEnvironment(input: {
  environmentId?: unknown;
  environment?: unknown;
}): Promise<{ id: string; name: string } | null | undefined> {
  if (input.environmentId !== undefined) {
    if (input.environmentId === null || input.environmentId === "") return null;
    if (typeof input.environmentId !== "string") throw new ApiError("ENVIRONMENT_NOT_FOUND");
    const stage = await getEnvironment(input.environmentId);
    if (!stage) throw new ApiError("ENVIRONMENT_NOT_FOUND");
    return { id: stage.id, name: stage.name };
  }
  if (input.environment !== undefined) {
    if (input.environment === null || (typeof input.environment === "string" && !input.environment.trim())) return null;
    if (typeof input.environment !== "string") throw new ApiError("ENVIRONMENT_NOT_FOUND");
    const stage = await findEnvironmentByName(input.environment);
    if (!stage)
      throw new ApiError("ENVIRONMENT_NOT_FOUND", {
        details: { known: (await listEnvironments()).map((s) => s.name) },
      });
    return { id: stage.id, name: stage.name };
  }
  return undefined;
}
