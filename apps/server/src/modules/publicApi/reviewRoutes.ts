import type { FastifyInstance } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { requireProjectAccess } from "../../shared/guards.js";
import type { ReviewDeployBody, ReviewRequestBody } from "../reviews/routes.js";
import { decideOnReview, deployReview, listReviews, requestReview, withdrawReview } from "../reviews/service.js";
import { API_RATE_LIMIT, DEPLOY_RATE_LIMIT } from "./rateLimits.js";

/**
 * Review before a stage whose protection is `review`, under `/api/v1` — the
 * app's own rules (`reviews/service.ts`): a key acts as its owner, so a key
 * cannot approve what its owner requested, in the app or with another key.
 * Reading takes `projects:read`; everything that moves a deployment forward
 * or stops it takes `deployments:trigger`.
 */
export function registerPublicReviewRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/reviews", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    return { reviews: listReviews(user, id) };
  });

  app.post("/api/v1/projects/:id/connections/:connId/reviews", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    const body = (req.body ?? {}) as ReviewRequestBody;
    return { review: await requestReview({ user, req, v1: true }, project, connId, body) };
  });

  app.post("/api/v1/projects/:id/reviews/:reviewId/approve", API_RATE_LIMIT, async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    const { comment } = (req.body ?? {}) as { comment?: string };
    return { review: decideOnReview({ user, req, v1: true }, id, reviewId, "approved", comment) };
  });

  app.post("/api/v1/projects/:id/reviews/:reviewId/reject", API_RATE_LIMIT, async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    const { comment } = (req.body ?? {}) as { comment?: string };
    return { review: decideOnReview({ user, req, v1: true }, id, reviewId, "rejected", comment) };
  });

  app.post("/api/v1/projects/:id/reviews/:reviewId/withdraw", API_RATE_LIMIT, async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    return { review: withdrawReview({ user, req, v1: true }, id, reviewId) };
  });

  app.post("/api/v1/projects/:id/reviews/:reviewId/deploy", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user, project } = requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    return deployReview({ user, req, v1: true }, project, reviewId, (req.body ?? {}) as ReviewDeployBody);
  });
}
