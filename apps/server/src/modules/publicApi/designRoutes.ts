import type { FastifyInstance } from "fastify";
import { getTablesMap, readProjectFromDoc, translateType, type TypeTarget } from "@nebuladb/shared";
import { requireScope } from "../apiKeys/auth.js";
import { isValidEngine } from "../connections/engines.js";
import { resolveProjectLint } from "../lint/repository.js";
import { lockGuardFor } from "../tableLocks/access.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { idParams, parseParams } from "../../shared/validate.js";
import { API_RATE_LIMIT } from "./rateLimits.js";
import { findTable } from "./tableRef.js";

/** Bounds of the canvas a position may be set within — far beyond any real diagram. */
const MAX_COORDINATE = 1_000_000;
const MAX_LAYOUT_TABLES = 500;
const MAX_CONVERT_FIELDS = 5000;
/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`: what the canvas's colour picker writes. */
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function invalid(message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", { message });
}

interface LayoutChange {
  table: string;
  x?: number;
  y?: number;
  color?: string | null;
}

function parseLayout(raw: unknown): LayoutChange[] {
  const tables = (raw as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(tables) || tables.length === 0 || tables.length > MAX_LAYOUT_TABLES) {
    throw invalid(`tables must be a list of 1 to ${MAX_LAYOUT_TABLES} changes`);
  }
  return tables.map((entry) => {
    const { table, x, y, color } = (entry ?? {}) as Record<string, unknown>;
    if (typeof table !== "string" || !table) throw invalid("each change names its table (id or name)");
    const coordinate = (value: unknown, name: string) => {
      if (value === undefined) return undefined;
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
        throw invalid(`${name} must be a number within ±${MAX_COORDINATE}`);
      }
      return Math.round(value);
    };
    if (color !== undefined && color !== null && (typeof color !== "string" || !COLOR.test(color))) {
      throw invalid("color must be a hex colour (#rrggbb) or null to remove it");
    }
    const change: LayoutChange = { table, x: coordinate(x, "x"), y: coordinate(y, "y") };
    if (color !== undefined) change.color = color as string | null;
    if (change.x === undefined && change.y === undefined && color === undefined) {
      throw invalid(`nothing to change for ${table}: give x, y or color`);
    }
    return change;
  });
}

/**
 * The canvas and the editor's own one-off schema actions under `/api/v1`, for scripts and AI agents:
 * moving and colouring tables (what dragging and the colour picker do — table locks freeze structure,
 * never layout, here as on the canvas), converting column types for an engine (the editor's
 * "Convert types", with the same type table) and reading the lint rules that apply.
 */
export function registerPublicDesignRoutes(app: FastifyInstance): void {
  app.patch("/api/v1/projects/:id/layout", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user, project } = await requireProjectAccess(req, id, "edit");
    requireScope(req, "projects:write", id);
    const changes = parseLayout(req.body);

    // From here to `room.write`, nothing waits: see `Room.write`.
    const room = await getRoom(id);
    const tables = getTablesMap(room.doc);
    const current = readProjectFromDoc(room.doc, project.id, project.name);
    const resolved = changes.map((change) => {
      const table = findTable(current.tables, change.table);
      if (!table) throw new ApiError("TABLE_NOT_FOUND", { message: `no table "${change.table}" in this project` });
      return { change, tableId: table.id };
    });
    await room.write(() => {
      for (const { change, tableId } of resolved) {
        const table = tables.get(tableId);
        if (!table) continue;
        const position = { x: change.x ?? table.position.x, y: change.y ?? table.position.y };
        let style = table.style;
        if (change.color === null) {
          style = table.style?.borderColor ? { borderColor: table.style.borderColor } : undefined;
        } else if (change.color !== undefined) {
          style = { ...table.style, color: change.color };
        }
        tables.set(tableId, { ...table, position, style });
      }
    }, user.displayName);
    await auditUser(user, "project.import", { type: "project", id }, `layout of ${resolved.length} table(s) (v1)`, req);
    return { updated: resolved.length };
  });

  app.post("/api/v1/projects/:id/convert-types", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const body = (req.body ?? {}) as { target?: unknown; apply?: unknown; fields?: unknown };
    const apply = body.apply === true;
    const { user, project } = await requireProjectAccess(req, id, apply ? "edit" : "view");
    requireScope(req, apply ? "projects:write" : "projects:read", id);
    if (body.target !== "duckdb" && !isValidEngine(body.target)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    const target = body.target as TypeTarget;
    let only: Set<string> | null = null;
    if (body.fields !== undefined) {
      if (
        !Array.isArray(body.fields) ||
        body.fields.length > MAX_CONVERT_FIELDS ||
        !body.fields.every((f) => typeof f === "string" && f.length <= 400)
      ) {
        throw invalid('fields must be a list of "table.column" names');
      }
      only = new Set((body.fields as string[]).map((f) => f.toLowerCase()));
    }

    const assertLocksAllow = apply ? await lockGuardFor(user.id, id) : null;
    // From here to `room.write`, nothing waits: see `Room.write`.
    const room = await getRoom(id);
    const current = readProjectFromDoc(room.doc, project.id, project.name);
    const changes: { tableId: string; fieldId: string; table: string; field: string; from: string; to: string }[] = [];
    for (const table of current.tables) {
      for (const field of table.fields) {
        if (only && !only.has(`${table.name}.${field.name}`.toLowerCase())) continue;
        const translated = translateType(field.type, target);
        if (translated.changed && translated.type !== field.type) {
          changes.push({
            tableId: table.id,
            fieldId: field.id,
            table: table.name,
            field: field.name,
            from: field.type,
            to: translated.type,
          });
        }
      }
    }
    const summary = changes.map(({ table, field, from, to }) => ({ table, field, from, to }));
    if (!apply || changes.length === 0) return { target, applied: false, changes: summary };

    const byTable = new Map<string, Map<string, string>>();
    for (const change of changes) {
      if (!byTable.has(change.tableId)) byTable.set(change.tableId, new Map());
      byTable.get(change.tableId)!.set(change.fieldId, change.to);
    }
    const next = {
      ...current,
      tables: current.tables.map((table) => {
        const types = byTable.get(table.id);
        return types
          ? { ...table, fields: table.fields.map((f) => ({ ...f, type: types.get(f.id) ?? f.type })) }
          : table;
      }),
    };
    // A type is structure: a locked table keeps its own.
    assertLocksAllow!(current, next);
    const tables = getTablesMap(room.doc);
    await room.write(() => {
      for (const table of next.tables) if (byTable.has(table.id)) tables.set(table.id, table);
    }, user.displayName);
    await auditUser(
      user,
      "project.import",
      { type: "project", id },
      `converted ${changes.length} column type(s) for ${target} (v1)`,
      req,
    );
    return { target, applied: true, changes: summary };
  });

  // The lint rules that apply to the project and where they come from — reading only: choosing them is a
  // project administrator's (`PUT /api/projects/:id/lint`), out of reach of a key.
  app.get("/api/v1/projects/:id/lint/rules", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return await resolveProjectLint(id);
  });
}
