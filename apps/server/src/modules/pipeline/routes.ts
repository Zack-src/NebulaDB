import type { FastifyInstance, FastifyRequest } from "fastify";
import { readProjectFromDoc } from "@nebuladb/shared";
import { getRoom } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAdmin } from "../../shared/guards.js";
import { projectPipeline, schemaHashOf } from "./pipeline.js";

const REASON_MAX = 300;

/**
 * Whether this deployment request may skip the stage order, checked before
 * anything else runs: skipping is for instance administrators, needs a reason,
 * and is written to the audit log whatever the deployment then does.
 */
export function stageSkipFor(
  req: FastifyRequest,
  projectId: string,
  connectionId: string,
  body: { skipStageOrder?: unknown; skipReason?: unknown },
): boolean {
  if (body.skipStageOrder !== true) return false;
  const user = requireAdmin(req);
  const reason = typeof body.skipReason === "string" ? body.skipReason.trim().slice(0, REASON_MAX) : "";
  if (!reason) throw new ApiError("STAGE_SKIP_REASON_REQUIRED");
  auditUser(user, "connection.deploy.stage_skipped", { type: "project", id: projectId }, reason, req, {
    connectionId,
  });
  return true;
}

/**
 * The pipeline: the project's databases along the chain of stages, and how
 * far the current schema has got. For the project's administrators, like the
 * deployment history it is read from.
 */
export function registerPipelineRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/pipeline", async (req) => {
    const { id } = req.params as { id: string };
    const { project } = requireProjectAdmin(req, id);
    const schema = readProjectFromDoc(getRoom(id).doc, id, project.name);
    return { pipeline: projectPipeline(id, schemaHashOf(schema)) };
  });
}
