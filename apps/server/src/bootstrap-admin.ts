import { db } from "./infrastructure/db.js";
import { normalizeEmail } from "./modules/auth/email.js";
import { checkPassword, hashPassword } from "./modules/auth/password.js";

/**
 * Creates the first global-admin account, bypassing invitations entirely —
 * every other account can only be created by accepting an admin-issued
 * invitation, so there has to be one way in that doesn't depend on an
 * account already existing.
 *
 * Usage: `npm run bootstrap-admin -w apps/server -- <email> <password>`.
 * Respects `ATHANORDB_DB_PATH` the same as the server itself.
 */
async function main(): Promise<void> {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error("Usage: npm run bootstrap-admin -w apps/server -- <email> <password>");
    process.exit(1);
  }

  const email = normalizeEmail(emailArg);
  if (!email) {
    console.error("invalid email");
    process.exit(1);
  }
  const check = checkPassword(passwordArg);
  if (!check.ok) {
    console.error(check.error);
    process.exit(1);
  }
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    console.error(`a user with email ${email} already exists`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(check.password);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 1)").run(id, email, passwordHash);
  console.log(`created global admin ${email} (id ${id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
