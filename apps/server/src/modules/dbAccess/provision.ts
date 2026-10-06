import crypto from "node:crypto";
import type { DbAccessGrantInput } from "@nebuladb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { auditUser } from "../../shared/audit.js";
import { savePersonalCredentials, personalCredentialStatus } from "../connections/personalCredentials.js";
import { getConnectionById } from "../connections/repository.js";
import { createAdminDriver } from "../dbAdmin/drivers/index.js";
import type { SessionUser } from "../auth/session.js";

/** Uses the requesting administrator's own SQL account, never an implicit service identity. */
export const accountProvisioner = {
  async create(connectionId: string, name: string, password: string): Promise<void> {
    const connection = getConnectionById(connectionId)!;
    const driver = await createAdminDriver(connection, "adminWrite");
    try {
      await driver.execute(
        driver.userStatements({ type: "create", principal: { name }, password }),
        connection.database,
      );
    } finally {
      await driver.close().catch(() => {});
    }
  },
};
export interface ProvisionResult {
  userId: string;
  connectionId: string;
  status: "created" | "existing" | "failed";
  username?: string;
}
export async function provisionAccounts(
  admin: SessionUser,
  users: { id: string; email: string }[],
  entries: DbAccessGrantInput[],
): Promise<ProvisionResult[]> {
  const results: ProvisionResult[] = [];
  for (const user of users)
    for (const entry of entries) {
      const connection = getConnectionById(entry.connectionId);
      if (!connection || connection.authMode !== "personal" || connection.readOnly) continue;
      const current = personalCredentialStatus(connection, user.id);
      if (current.username) {
        results.push({ userId: user.id, connectionId: connection.id, status: "existing", username: current.username });
        continue;
      }
      // Stable collision-resistant name; never a password or an unescaped SQL identifier.
      const username = entry.sqlUsername || `ath_${user.id.replace(/-/g, "").slice(0, 24)}`;
      const password = crypto.randomBytes(24).toString("base64url");
      try {
        await accountProvisioner.create(connection.id, username, password);
        savePersonalCredentials(connection.id, user.id, username, password);
        auditUser(
          admin,
          "dbuser.create",
          { type: "connection", id: connection.id },
          `${connection.name}: ${username} for ${user.email}`,
        );
        results.push({ userId: user.id, connectionId: connection.id, username, status: "created" });
      } catch {
        auditUser(
          admin,
          "dbuser.create_failed",
          { type: "connection", id: connection.id },
          `${connection.name}: ${username} for ${user.email}`,
        );
        results.push({ userId: user.id, connectionId: connection.id, status: "failed" });
      }
    }
  return results;
}

/**
 * Creates, on each database an invitation asked for it, the account the new
 * person will use there, and keeps it as their personal account — so they
 * never see or choose a database password. The connection's service account
 * does the creating; the new account has no privilege yet (an administrator
 * grants them in "Utilisateurs"). A failure leaves the Nebula account and
 * its access as they are and is only audited: the person can still give an
 * account of their own.
 */
export async function provisionInvitedAccounts(
  user: { id: string; email: string },
  entries: DbAccessGrantInput[],
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  for (const entry of entries) {
    const name = entry.sqlUsername;
    if (!entry.createAccount || !name) continue;
    const connection = getConnectionById(entry.connectionId);
    if (!connection || connection.authMode !== "personal" || connection.readOnly) continue;
    const label = `${connection.name}: ${name}`;
    const target = { type: "connection", id: connection.id };
    try {
      const password = crypto.randomBytes(24).toString("base64url");
      await asUnattended(async () => {
        const driver = await createAdminDriver(connection, "adminWrite");
        try {
          await driver.execute(driver.userStatements({ type: "create", principal: { name }, password }), undefined);
        } finally {
          await driver.close().catch(() => {});
        }
      });
      savePersonalCredentials(connection.id, user.id, name, password);
      auditUser(user, "dbuser.create", target, `${label} (invitation)`);
    } catch (err) {
      log.error({ err }, "invitation: database account not created");
      auditUser(user, "dbuser.create_failed", target, `${label} (invitation)`);
    }
  }
}
