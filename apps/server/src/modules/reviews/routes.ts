import type { FastifyInstance } from "fastify";
import type { MigrationResolutionMap } from "@nebuladb/shared";
import { requireProjectAccess } from "../../shared/guards.js";
import { decideOnReview, deployReview, listReviews, requestReview, withdrawReview } from "./service.js";

/** Same ceiling as the connection routes: asking for a review and deploying one both open the database. */
const REVIEW_RATE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

export interface ReviewRequestBody {
  resolutions?: MigrationResolutionMap;
  skipSeeds?: boolean;
  riskNote?: string;
  message?: string;
}

export interface ReviewDeployBody {
  confirmName?: string;
  backupBefore?: boolean;
  skipStageOrder?: boolean;
  skipReason?: string;
}

/**
 * Review before a stage whose protection is `review` (see `service.ts`).
 * Every route asks for the project's `deploy` level, like the deployment it
 * stands in front of; who among those may approve, deploy or withdraw a given
 * request is the service's rule.
 */
export function registerReviewRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/reviews", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    return { reviews: listReviews(user, id) };
  });

  app.post("/api/projects/:id/connections/:connId/reviews", REVIEW_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAccess(req, id, "deploy");
    return { review: await requestReview({ user, req }, project, connId, (req.body ?? {}) as ReviewRequestBody) };
  });

  app.post("/api/projects/:id/reviews/:reviewId/approve", async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    const { comment } = (req.body ?? {}) as { comment?: string };
    return { review: decideOnReview({ user, req }, id, reviewId, "approved", comment) };
  });

  app.post("/api/projects/:id/reviews/:reviewId/reject", async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    const { comment } = (req.body ?? {}) as { comment?: string };
    return { review: decideOnReview({ user, req }, id, reviewId, "rejected", comment) };
  });

  app.post("/api/projects/:id/reviews/:reviewId/withdraw", async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user } = requireProjectAccess(req, id, "deploy");
    return { review: withdrawReview({ user, req }, id, reviewId) };
  });

  app.post("/api/projects/:id/reviews/:reviewId/deploy", REVIEW_RATE_LIMIT, async (req) => {
    const { id, reviewId } = req.params as { id: string; reviewId: string };
    const { user, project } = requireProjectAccess(req, id, "deploy");
    return deployReview({ user, req }, project, reviewId, (req.body ?? {}) as ReviewDeployBody);
  });
}
