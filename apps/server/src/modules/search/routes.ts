import type { FastifyInstance } from "fastify";
import { getEffectivePermission } from "../../shared/permissions.js";
import { requireUser } from "../../shared/guards.js";
import { listProjectSummaries } from "../projects/repository.js";
import { MIN_QUERY_LENGTH, searchProjects } from "./searchIndex.js";

/** The client searches as the user types (debounced); this caps a script hammering it, not a person. */
const SEARCH_RATE_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const MAX_QUERY_LENGTH = 100;

export function registerSearchRoutes(app: FastifyInstance): void {
  /**
   * Every table/column/enum whose name matches `q`, across every project the
   * caller can at least view. Trashed projects are left out — they're on
   * their way out, and opening one from a result isn't possible anyway.
   */
  app.get("/api/search", SEARCH_RATE_LIMIT, async (req) => {
    const user = requireUser(req);
    const q = String((req.query as { q?: unknown }).q ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);
    if (q.length < MIN_QUERY_LENGTH) return { hits: [], truncated: false };

    const visible = listProjectSummaries().filter(
      (project) => project.status !== "trashed" && getEffectivePermission(user.id, project.id) !== null,
    );
    return searchProjects(visible, q);
  });
}
