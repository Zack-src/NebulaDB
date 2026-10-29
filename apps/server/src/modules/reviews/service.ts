import type { FastifyRequest } from "fastify";
import {
  readProjectFromDoc,
  REVIEW_APPROVAL_TTL_DAYS,
  type DeploymentReview,
  type DeploymentReviewCloseReason,
  type MigrationResolutionMap,
} from "@nebuladb/shared";
import { getRoom, notifyProject } from "../../realtime/roomRegistry.js";
import { filterAsync, mapAsync } from "../../shared/async.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { canDeployProject } from "../../shared/permissions.js";
import type { SessionUser } from "../auth/session.js";
import { deployToConnection, freezeDeployment, type DeployToConnectionResult } from "../connections/deploy.js";
import { notifyDirectly } from "../notifications/repository.js";
import { schemaHashOf } from "../pipeline/pipeline.js";
import { stageSkipFor } from "../pipeline/routes.js";
import { getProjectRow } from "../projects/repository.js";
import { emitWebhookEvent } from "../webhooks/dispatcher.js";
import {
  closeReview,
  decideReview,
  getReview,
  insertReview,
  listEnabledUserIds,
  listOpenReviewStates,
  listProjectReviews,
  markReviewDeployed,
  sqlTime,
  type StoredReview,
} from "./repository.js";

/**
 * Review before a stage whose protection is `review`.
 *
 * Someone who may deploy prepares the deployment and asks for a review; the
 * request freezes what was prepared. Another person who may deploy on the
 * project — never the author; an instance administrator counts, as they may
 * deploy everywhere — approves or rejects. Once approved, the author or the
 * approver deploys the request, and the server runs it only if the plan made
 * at that moment is still the one that was read (`deploy.ts`).
 *
 * So one person alone on a project cannot deploy to such a stage, whatever
 * their level: an instance administrator approves, or changes the stage.
 */

const MESSAGE_MAX = 1000;
const LISTED = 30;

/** Who acts, and how the action reached the server — for the audit trail. */
export interface ReviewActor {
  user: SessionUser;
  req: FastifyRequest;
  /** Through `/api/v1`: said in the audit detail, like every other route there. */
  v1?: boolean;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, MESSAGE_MAX) : null;

const isExpired = (review: StoredReview, now: Date) =>
  review.status === "approved" && review.expiresAt !== null && review.expiresAt <= sqlTime(now);

async function toReview(
  review: StoredReview,
  user: SessionUser,
  currentSchemaHash: string | null,
): Promise<DeploymentReview> {
  const open = review.status === "pending" || review.status === "approved";
  const author = review.requestedBy === user.id;
  return {
    id: review.id,
    projectId: review.projectId,
    connectionId: review.connectionId,
    connectionName: review.connectionName,
    environment: review.environment,
    engine: review.engine,
    status: review.status,
    schemaHash: review.schemaHash,
    sql: review.sql,
    risks: review.risks,
    skipSeeds: review.skipSeeds,
    ...(review.riskNote ? { riskNote: review.riskNote } : {}),
    ...(review.message ? { message: review.message } : {}),
    requestedByEmail: review.requestedByEmail,
    requestedAt: review.requestedAt,
    ...(review.decidedByEmail ? { decidedByEmail: review.decidedByEmail } : {}),
    ...(review.decidedAt ? { decidedAt: review.decidedAt } : {}),
    ...(review.comment ? { comment: review.comment } : {}),
    ...(review.expiresAt ? { expiresAt: review.expiresAt } : {}),
    ...(review.closedAt ? { closedAt: review.closedAt } : {}),
    ...(review.closeReason ? { closeReason: review.closeReason } : {}),
    ...(review.deploymentId ? { deploymentId: review.deploymentId } : {}),
    schemaChanged: open && currentSchemaHash !== null && currentSchemaHash !== review.schemaHash,
    viewer: {
      canDecide: review.status === "pending" && !author && (await canDeployProject(user.id, review.projectId)),
      canDeploy: review.status === "approved" && (author || review.decidedBy === user.id),
      canWithdraw: open && author,
    },
  };
}

async function currentSchemaHash(projectId: string): Promise<string | null> {
  const project = await getProjectRow(projectId);
  return project ? schemaHashOf(readProjectFromDoc((await getRoom(projectId)).doc, projectId, project.name)) : null;
}

/** Those who could approve a request: everyone who may deploy on the project (instance administrators included), but its author. */
async function reviewersOf(review: StoredReview): Promise<string[]> {
  return await filterAsync(
    (await listEnabledUserIds()).filter((id) => id !== review.requestedBy),
    (id) => canDeployProject(id, review.projectId),
  );
}

type ReviewAction =
  "requested" | "approved" | "rejected" | "withdrawn" | "deployed" | "expired" | "stale" | "cancelled";

/**
 * Says what happened to a request: to the accounts it concerns (the bell),
 * to the project's webhooks, and to the open editors, whose list is stale.
 */
async function announce(
  review: StoredReview,
  action: ReviewAction,
  by: string | null,
  to: Iterable<string | null>,
  reason: DeploymentReviewCloseReason | null = null,
): Promise<void> {
  await notifyDirectly(
    review.projectId,
    [...to].filter((id): id is string => id !== null),
    "review",
    { action, by, connection: review.connectionName, environment: review.environment, reason },
  );
  // A deployment has its own event (`deployment.completed`); the review's end is in it.
  if (action !== "deployed") {
    await emitWebhookEvent(review.projectId, "deployment.review", {
      action,
      reviewId: review.id,
      connectionName: review.connectionName,
      environment: review.environment,
      engine: review.engine,
      requestedBy: review.requestedByEmail,
      by,
      reason,
    });
  }
  notifyProject(review.projectId, { type: "reviews-changed" });
}

/**
 * Closes the open requests that no longer stand: an approval past its date,
 * a connection detached from the project, moved to another stage, or whose
 * stage stopped asking for a review. Judged on what the rows say now, so it
 * does not depend on every route that can change a connection or a stage
 * remembering to call it: every read and every action here starts with it.
 * The routes that change a stage or detach a connection call it too, so the
 * author learns at once, and the change is in the audit trail under whoever
 * made it (`actor`).
 */
export async function reconcileReviews(projectId?: string, actor?: ReviewActor): Promise<void> {
  const now = new Date();
  for (const { review, linked, currentEnvironmentId, currentProtection } of await listOpenReviewStates(projectId)) {
    const reason: DeploymentReviewCloseReason | null =
      !linked || currentEnvironmentId !== review.environmentId
        ? "connection"
        : currentProtection !== "review"
          ? "protection"
          : null;
    if (reason) {
      if (!(await closeReview(review.id, "cancelled", reason, now))) continue;
      if (actor) {
        await auditUser(
          actor.user,
          "connection.review.cancel",
          { type: "project", id: review.projectId },
          `${review.connectionName}: request of ${review.requestedByEmail} cancelled (${reason})`,
          actor.req,
          { connectionId: review.connectionId },
        );
      }
      await announce(review, "cancelled", actor?.user.email ?? null, [review.requestedBy], reason);
    } else if (isExpired(review, now) && (await closeReview(review.id, "expired", null, now))) {
      await announce(review, "expired", null, [review.requestedBy, review.decidedBy]);
    }
  }
}

/** The project's requests, newest first, with what the caller may do with each. */
export async function listReviews(user: SessionUser, projectId: string): Promise<DeploymentReview[]> {
  await reconcileReviews(projectId);
  const hash = await currentSchemaHash(projectId);
  return await mapAsync(await listProjectReviews(projectId, LISTED), (review) => toReview(review, user, hash));
}

/** A request of this project, after `reconcileReviews`: what every action below starts from. */
async function requireReview(projectId: string, reviewId: string): Promise<StoredReview> {
  await reconcileReviews(projectId);
  const review = await getReview(reviewId);
  if (!review || review.projectId !== projectId) throw new ApiError("DEPLOYMENT_REVIEW_NOT_FOUND");
  return review;
}

/** Closes a request whose plan no longer holds, and tells its author. */
async function closeAsStale(review: StoredReview, reason: DeploymentReviewCloseReason, by: SessionUser): Promise<void> {
  if (!(await closeReview(review.id, "stale", reason, new Date()))) return;
  await announce(review, "stale", by.email, [review.requestedBy === by.id ? null : review.requestedBy], reason);
}

/**
 * Prepares the deployment as it would run now and keeps it for a reviewer.
 * One open request per project and connection: a second one is refused until
 * the first is deployed, withdrawn, rejected or closed.
 */
export async function requestReview(
  actor: ReviewActor,
  project: { id: string; name: string },
  connId: string,
  body: { resolutions?: MigrationResolutionMap; skipSeeds?: unknown; riskNote?: unknown; message?: unknown },
): Promise<DeploymentReview> {
  const { user } = actor;
  await reconcileReviews(project.id);
  const resolutions = body.resolutions && typeof body.resolutions === "object" ? body.resolutions : {};
  const skipSeeds = body.skipSeeds === true;
  const frozen = await freezeDeployment(project.id, project.name, connId, resolutions, { skipSeeds });
  const review = await insertReview({
    projectId: project.id,
    connectionId: frozen.connection.id,
    connectionName: frozen.connection.name,
    environmentId: frozen.connection.environmentId ?? null,
    environment: frozen.connection.environment ?? null,
    engine: frozen.connection.engine,
    schemaHash: frozen.schemaHash,
    sql: frozen.sql,
    resolutions,
    risks: frozen.acceptedRisks,
    seedsHash: frozen.seedsHash,
    skipSeeds,
    riskNote: text(body.riskNote),
    message: text(body.message),
    requestedBy: user.id,
    requestedByEmail: user.email,
    requestedAt: new Date(),
  });
  if (!review) throw new ApiError("DEPLOYMENT_REVIEW_ALREADY_OPEN");

  await auditUser(
    user,
    "connection.review.request",
    { type: "project", id: project.id },
    `${review.connectionName}: review requested${actor.v1 ? " (v1)" : ""}`,
    actor.req,
    { connectionId: review.connectionId },
  );
  await announce(review, "requested", user.email, await reviewersOf(review));
  return await toReview(review, user, review.schemaHash);
}

/**
 * Approves or rejects a pending request. Never by its author, whatever their
 * level: a review is another person's reading. An approval is for the schema
 * the request froze — if the project's has moved since, the request is closed
 * as stale instead of approved for something nobody read.
 */
export async function decideOnReview(
  actor: ReviewActor,
  projectId: string,
  reviewId: string,
  decision: "approved" | "rejected",
  comment: unknown,
): Promise<DeploymentReview> {
  const { user } = actor;
  const review = await requireReview(projectId, reviewId);
  if (review.status !== "pending") throw new ApiError("DEPLOYMENT_REVIEW_NOT_PENDING");
  if (review.requestedBy === user.id) throw new ApiError("DEPLOYMENT_REVIEW_SELF_DECISION");

  if (decision === "approved" && (await currentSchemaHash(projectId)) !== review.schemaHash) {
    await closeAsStale(review, "schema", user);
    throw new ApiError("DEPLOYMENT_REVIEW_STALE", { details: { reason: "schema" } });
  }

  const now = new Date();
  const expiresAt =
    decision === "approved" ? new Date(now.getTime() + REVIEW_APPROVAL_TTL_DAYS * 24 * 3_600_000) : null;
  const decided = await decideReview(
    review.id,
    { status: decision, by: user.id, byEmail: user.email, comment: text(comment), at: now },
    expiresAt,
  );
  if (!decided) throw new ApiError("DEPLOYMENT_REVIEW_NOT_PENDING");

  const after = (await getReview(review.id))!;
  await auditUser(
    user,
    decision === "approved" ? "connection.review.approve" : "connection.review.reject",
    { type: "project", id: projectId },
    `${review.connectionName}: request of ${review.requestedByEmail} ${decision}${actor.v1 ? " (v1)" : ""}`,
    actor.req,
    { connectionId: review.connectionId },
  );
  await announce(after, decision, user.email, [review.requestedBy]);
  return await toReview(after, user, review.schemaHash);
}

/** The author takes their request back, pending or already approved. */
export async function withdrawReview(
  actor: ReviewActor,
  projectId: string,
  reviewId: string,
): Promise<DeploymentReview> {
  const { user } = actor;
  const review = await requireReview(projectId, reviewId);
  if (review.requestedBy !== user.id) throw new ApiError("DEPLOYMENT_REVIEW_NOT_YOURS");
  if (!(await closeReview(review.id, "withdrawn", null, new Date()))) {
    throw new ApiError("DEPLOYMENT_REVIEW_NOT_PENDING");
  }

  await auditUser(
    user,
    "connection.review.withdraw",
    { type: "project", id: projectId },
    `${review.connectionName}: request withdrawn${actor.v1 ? " (v1)" : ""}`,
    actor.req,
    { connectionId: review.connectionId },
  );
  // Those asked to look no longer have to; an approver learns their approval will not be used.
  await announce(review, "withdrawn", user.email, review.decidedBy ? [review.decidedBy] : await reviewersOf(review));
  return await toReview((await getReview(review.id))!, user, null);
}

/**
 * Deploys an approved request — by its author or its approver — with the
 * answers it froze. Everything a deployment checks is checked (production
 * confirmation, backup, lint, stage order), and the plan must still be the
 * approved one: otherwise the request is closed as stale and nothing runs.
 */
export async function deployReview(
  actor: ReviewActor,
  project: { id: string; name: string },
  reviewId: string,
  options: { confirmName?: string; backupBefore?: unknown; skipStageOrder?: unknown; skipReason?: unknown },
): Promise<DeployToConnectionResult> {
  const { user } = actor;
  const review = await requireReview(project.id, reviewId);
  if (review.status === "expired") throw new ApiError("DEPLOYMENT_REVIEW_EXPIRED");
  if (review.status !== "approved" || !review.connectionId) throw new ApiError("DEPLOYMENT_REVIEW_NOT_APPROVED");
  if (review.requestedBy !== user.id && review.decidedBy !== user.id) {
    throw new ApiError("DEPLOYMENT_REVIEW_NOT_YOURS");
  }
  // As for any deployment: an instance administrator's, with a reason, audited.
  const skipStageOrder = await stageSkipFor(actor.req, project.id, review.connectionId, options);

  let result: DeployToConnectionResult;
  try {
    result = await deployToConnection(project.id, project.name, review.connectionId, review.resolutions, user.email, {
      confirmName: options.confirmName,
      riskNote: review.riskNote ?? undefined,
      skipSeeds: review.skipSeeds,
      backupBefore: typeof options.backupBefore === "boolean" ? options.backupBefore : undefined,
      skipStageOrder,
      review: {
        id: review.id,
        schemaHash: review.schemaHash,
        sql: review.sql,
        risks: review.risks,
        seedsHash: review.seedsHash,
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "DEPLOYMENT_REVIEW_STALE") {
      await closeAsStale(review, (err.details?.reason as DeploymentReviewCloseReason | undefined) ?? "database", user);
    }
    throw err;
  }

  await markReviewDeployed(review.id, new Date());
  await auditUser(
    user,
    "connection.deploy",
    { type: "project", id: project.id },
    `${review.connectionId}: executed ${result.executedStatements} statements, reviewed (requested by ${review.requestedByEmail}, approved by ${review.decidedByEmail})${actor.v1 ? " (v1)" : ""}`,
    actor.req,
    { connectionId: review.connectionId },
  );
  // The other half of the pair learns it ran, whether or not they follow the project.
  await announce(review, "deployed", user.email, [
    review.requestedBy === user.id ? review.decidedBy : review.requestedBy,
  ]);
  return result;
}
