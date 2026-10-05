import crypto from "node:crypto";
import type { DbAccessGrantInput } from "@athanordb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { auditUser } from "../../shared/audit.js";
import { savePersonalCredentials } from "../connections/personalCredentials.js";
import { getConnectionById } from "../connections/repository.js";
import { createAdminDriver } from "../dbAdmin/drivers/index.js";

/**
 * Creates, on each database an invitation asked for it, the account the new
 * person will use there, and keeps it as their personal account — so they
 * never see or choose a database password. The connection's service account
 * does the creating; the new account has no privilege yet (an administrator
 * grants them in "Utilisateurs"). A failure leaves the Athanor account and
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
