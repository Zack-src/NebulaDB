import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../../shared/errors.js";

/**
 * The MCP server as one file (`packages/mcp/dist/nebuladb-mcp.mjs`, built by `npm run build`), from
 * the repository in development and from the image in production (the Dockerfile copies
 * `packages/mcp/dist`).
 */
export const MCP_BUNDLE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/mcp/dist/nebuladb-mcp.mjs",
);

const DOWNLOAD_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

/**
 * Hands out the MCP server an AI agent connects with (Settings → AI agent): one file Node 22+ runs
 * with nothing installed, so connecting an agent never depends on a package registry. Public, like
 * the OpenAPI document: it is the open-source client, not data — the API key it needs is what
 * guards the instance.
 */
export function registerMcpRoutes(app: FastifyInstance): void {
  app.get("/api/mcp/nebuladb-mcp.mjs", DOWNLOAD_LIMIT, async (_req, reply) => {
    if (!existsSync(MCP_BUNDLE_PATH)) throw new ApiError("MCP_BUNDLE_MISSING");
    return reply
      .type("text/javascript; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="nebuladb-mcp.mjs"')
      .header("X-Content-Type-Options", "nosniff")
      .send(createReadStream(MCP_BUNDLE_PATH));
  });
}
