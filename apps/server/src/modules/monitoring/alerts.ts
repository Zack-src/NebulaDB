import type { AccountChange } from "@nebuladb/shared";
import { appUrl, isMailEnabled, sendMail } from "../../infrastructure/mailer.js";
import { driftAlertEmail } from "../../shared/emailTemplates.js";
import { getProjectRow } from "../projects/repository.js";
import { listDriftEmailRecipients, notifyFollowers } from "../notifications/repository.js";
import { emitWebhookEvent } from "../webhooks/dispatcher.js";
import { isMuted } from "./repository.js";

/** What the watch found, as it is told to followers, by email and to webhooks. */
export interface DriftAlert {
  kind: "external" | "partial-deployment" | "accounts";
  connectionName: string;
  environment: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  /** `accounts` only. They name database accounts: only counted in anything sent out, never listed. */
  accountChanges?: AccountChange[];
}

/**
 * Tells the project of a new finding: the in-app notification, the followers who asked for email
 * too, the webhooks. The accounts watch is for project administrators (instance administrators
 * read the names on screen): a follower below that level is told nothing, by any channel.
 * Nothing at all is sent while the project's alerts are muted. Never throws: a notice that fails is logged, the watch goes on.
 */
export async function announceDrift(projectId: string, alert: DriftAlert): Promise<void> {
  // Muted: the event is recorded and listed, nothing is sent — and not sent later either.
  if (await isMuted(projectId)) return;
  const accounts = alert.kind === "accounts";
  const changes = alert.accountChanges ?? [];
  const needs = accounts ? ("administrator" as const) : undefined;
  await notifyFollowers(
    projectId,
    "drift",
    {
      kind: alert.kind,
      connection: alert.connectionName,
      environment: alert.environment,
      ...(accounts
        ? { changes: changes.length }
        : { tables: alert.added.length + alert.removed.length + alert.changed.length }),
    },
    { needs },
  );
  await emailDriftFollowers(projectId, alert, needs);
  const counts: Record<string, number> = {};
  for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  await emitWebhookEvent(projectId, "drift.detected", {
    kind: alert.kind,
    connectionName: alert.connectionName,
    environment: alert.environment,
    added: alert.added,
    removed: alert.removed,
    changed: alert.changed,
    ...(accounts ? { accountChanges: counts } : {}),
  });
}

async function emailDriftFollowers(
  projectId: string,
  alert: DriftAlert,
  needs: "administrator" | undefined,
): Promise<void> {
  if (!isMailEnabled()) return;
  try {
    const project = await getProjectRow(projectId);
    if (!project) return;
    const url = appUrl(`/project/${projectId}/deployments`);
    const mail = {
      projectName: project.name,
      connectionName: alert.connectionName,
      environment: alert.environment,
      kind: alert.kind,
      // The names of an accounts finding are in `added`/`removed` as canonical account lines: not sent.
      added: alert.kind === "accounts" ? [] : alert.added,
      removed: alert.kind === "accounts" ? [] : alert.removed,
      changed: alert.kind === "accounts" ? [] : alert.changed,
      accountChanges: alert.accountChanges?.length,
    };
    for (const to of await listDriftEmailRecipients(projectId, needs)) {
      sendMail(driftAlertEmail(to, mail, url)).catch((err: unknown) =>
        console.error("[monitoring] alert email failed:", err instanceof Error ? err.message : err),
      );
    }
  } catch (err) {
    console.error("[monitoring] could not prepare alert emails:", err);
  }
}
