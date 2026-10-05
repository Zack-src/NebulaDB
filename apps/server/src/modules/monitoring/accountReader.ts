import type { DbPrincipal } from "@athanordb/shared";
import type { DatabaseAdminDriver } from "../dbAdmin/drivers/index.js";
import { canonicalAccountLines, principalKey, type AccountListing } from "./accountFingerprint.js";

/**
 * Past this many accounts, the grants of the rest are not read (one query per
 * account): the watch must stay a light read. Said in the lines (`unread`),
 * so the fingerprint stays honest about what it covers.
 */
export const MAX_GRANT_READS = 300;

/**
 * Reads a database's accounts, memberships and privileges through its
 * administration driver — listing calls only, nothing is changed. Built-in
 * accounts are listed (being created, dropped or given a role is news) but
 * their own grants are not read. On SQL Server, the logins of the server and
 * the users of the connection's database are both read.
 *
 * Throws when a listing fails: a partial read would look like accounts
 * disappearing.
 */
export async function readAccountLines(driver: DatabaseAdminDriver, database?: string): Promise<string[]> {
  if (!driver.capabilities.users) throw new Error("this engine has no accounts");
  const principals: { principal: DbPrincipal; level?: string }[] = (await driver.listPrincipals()).map((principal) => ({
    principal,
  }));
  if (driver.capabilities.principalLevels && database) {
    for (const principal of await driver.listPrincipals(database)) principals.push({ principal, level: database });
  }
  const sorted = principals
    .map((entry) => ({ ...entry, key: principalKey(entry.principal, entry.level) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const listing: AccountListing[] = [];
  let reads = 0;
  let unread = 0;
  for (const { principal, level, key } of sorted) {
    let grants = null;
    if (!principal.system) {
      if (reads < MAX_GRANT_READS) {
        reads++;
        grants = await driver.listGrants({
          name: principal.name,
          host: principal.host,
          kind: principal.kind,
          // SQL Server: a login's grants are the server's, a user's its database's.
          database: driver.capabilities.principalLevels ? level : database,
        });
      } else {
        unread++;
      }
    }
    listing.push({ key, principal, grants });
  }
  return canonicalAccountLines(listing, unread);
}
