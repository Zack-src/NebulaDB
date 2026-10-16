import type { FastifyInstance } from "fastify";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { requireUser } from "../../shared/guards.js";
import { ApiError } from "../../shared/errors.js";
import { auditUser } from "../../shared/audit.js";
import { isValidEngine } from "./engines.js";
import {
  connectionOwner,
  connectionSummary,
  createPrivateConnection,
  deleteConnection,
  listAllConnections,
  listPrivateConnections,
  updateConnection,
} from "./repository.js";
import { listAccessibleConnections } from "../dbAccess/repository.js";
import { mapAsync } from "../../shared/async.js";

const LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
function input(raw: unknown): Omit<DatabaseConnectionConfig, "id" | "projectId"> {
  const body = (raw ?? {}) as DatabaseConnectionConfig;
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) throw new ApiError("NAME_REQUIRED");
  if (!isValidEngine(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
  // Explicit allowlist: ownership, policies and grants are never supplied by a client.
  return {
    name: body.name.trim(),
    engine: body.engine,
    host: body.host,
    port: body.port,
    database: body.database,
    user: body.user,
    password: body.password,
    ssl: body.ssl,
    connectionString: body.connectionString,
    filePath: body.filePath,
  };
}
export function registerPrivateConnectionRoutes(app: FastifyInstance): void {
  app.get("/api/me/connections", LIMIT, async (req) => {
    const user = requireUser(req);
    if (req.apiKey) throw new ApiError("FORBIDDEN");
    const shared = user.isAdmin
      ? await listAllConnections()
      : (
          await mapAsync(await listAccessibleConnections(user.id), (grant) => connectionSummary(grant.connectionId))
        ).filter((connection) => connection !== null);
    return { shared, personal: await listPrivateConnections(user.id) };
  });
  app.post("/api/me/connections", LIMIT, async (req, reply) => {
    const user = requireUser(req);
    if (req.apiKey) throw new ApiError("FORBIDDEN");
    if ((await listPrivateConnections(user.id)).length >= 50)
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "personal connection limit reached" });
    const connection = await createPrivateConnection(input(req.body), user.id);
    await auditUser(
      user,
      "dbconn.create",
      { type: "connection", id: connection.id },
      `private: ${connection.name}`,
      req,
    );
    return reply.code(201).send({ connection });
  });
  app.put("/api/me/connections/:id", LIMIT, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (req.apiKey || (await connectionOwner(id)) !== user.id) throw new ApiError("CONNECTION_NOT_FOUND");
    const connection = await updateConnection(id, input(req.body));
    await auditUser(user, "dbconn.update", { type: "connection", id }, `private: ${connection?.name}`, req);
    return { connection };
  });
  app.delete("/api/me/connections/:id", LIMIT, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (req.apiKey || (await connectionOwner(id)) !== user.id) throw new ApiError("CONNECTION_NOT_FOUND");
    const name = (await connectionSummary(id))?.name;
    await deleteConnection(id);
    await auditUser(user, "dbconn.delete", { type: "connection", id }, `private: ${name}`, req);
    return { deleted: true };
  });
}
