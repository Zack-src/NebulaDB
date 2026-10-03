import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Ordered, one-way migrations applied on top of the baseline schema (the
 * `CREATE TABLE IF NOT EXISTS` block in `db.ts`, itself idempotent and safe
 * to run unconditionally on every boot — a brand-new install gets the full
 * current shape for free and simply has nothing pending here).
 *
 * Tracked via SQLite's built-in `PRAGMA user_version` rather than a separate
 * migrations table: one integer, set atomically in the same transaction as
 * the schema change it corresponds to, with no per-row bookkeeping needed
 * for what is — and is expected to stay — a short linear list. Replaces the
 * two one-off `PRAGMA table_info` + guarded `ALTER TABLE` checks that used
 * to live directly in `db.ts`; the next schema change is a new entry here
 * instead of another hand-rolled check that's easy to forget.
 *
 * Each `up` still guards its own `ALTER` (checking the column doesn't
 * already exist) rather than trusting `user_version` alone — belt and
 * suspenders against a database that reached the current shape some other
 * way (e.g. restored from an old backup that predates this file existing).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "projects.status column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "status")) {
        db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
      }
    },
  },
  {
    version: 2,
    name: "projects.owner_id column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "owner_id")) {
        db.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)");
      }
    },
  },
  {
    version: 3,
    name: "users.disabled_at column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "disabled_at")) {
        db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
      }
    },
  },
  {
    version: 4,
    name: "sessions.user_agent and ip columns",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "user_agent")) {
        db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT");
      }
      if (!columns.some((c) => c.name === "ip")) {
        db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT");
      }
    },
  },
  {
    version: 5,
    name: "login_attempts table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          email TEXT PRIMARY KEY,
          failures INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          last_failure_at TEXT
        );
      `);
    },
  },
  {
    version: 6,
    name: "audit_log table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          actor_id TEXT,
          actor_email TEXT,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          detail TEXT,
          ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
      `);
    },
  },
  {
    version: 7,
    name: "sessions.ttl_ms column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "ttl_ms")) {
        db.exec("ALTER TABLE sessions ADD COLUMN ttl_ms INTEGER");
      }
    },
  },
  {
    version: 8,
    name: "project_connections table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_connections (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          engine TEXT NOT NULL,
          config_encrypted TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_project_connections_proj ON project_connections(project_id);
      `);
    },
  },
  {
    version: 9,
    name: "users.totp columns",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      // Encrypted with the same `ATHANORDB_SECRET`-derived key as a live
      // connection's credentials (`shared/crypto.ts`) — a TOTP secret is
      // exactly as sensitive as a database password (whoever has it can log
      // in as this user), so it gets the same at-rest treatment rather than
      // sitting in the users table in the clear.
      if (!columns.some((c) => c.name === "totp_secret_encrypted")) {
        db.exec("ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT");
      }
      // Null while a setup is pending confirmation (a scanned-but-not-yet-
      // verified secret must not gate login), set once the enrolling user
      // proves they can produce a real code.
      if (!columns.some((c) => c.name === "totp_enabled_at")) {
        db.exec("ALTER TABLE users ADD COLUMN totp_enabled_at TEXT");
      }
    },
  },
  {
    version: 10,
    name: "totp_backup_codes table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS totp_backup_codes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user ON totp_backup_codes(user_id);
      `);
    },
  },
  {
    version: 11,
    name: "mfa_challenges table",
    up: (db) => {
      // A password has already been verified by the time one of these rows
      // exists — it holds just enough to finish the second factor (which
      // user, how many wrong codes so far) without granting any access
      // itself. Deliberately not a `sessions` row: an MFA-pending login isn't
      // a session, and giving it one shape would mean every session reader
      // in the app (WS auth included) would need to know to check for it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS mfa_challenges (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          remember INTEGER NOT NULL DEFAULT 1,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 12,
    name: "project_connections.environment column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(project_connections)").all() as { name: string }[];
      // Free-text label ("production", "staging", a client name — whatever
      // the operator calls it), not an enum: `deployment_history` copies it
      // at deployment time precisely so a later rename of the connection
      // doesn't rewrite what past history says it was deployed to.
      if (!columns.some((c) => c.name === "environment")) {
        db.exec("ALTER TABLE project_connections ADD COLUMN environment TEXT");
      }
    },
  },
  {
    version: 13,
    name: "deployment_history table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS deployment_history (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          connection_id TEXT REFERENCES project_connections(id) ON DELETE SET NULL,
          connection_name TEXT NOT NULL,
          environment TEXT,
          engine TEXT NOT NULL,
          sql TEXT NOT NULL,
          rollback_sql TEXT,
          rollback_of TEXT REFERENCES deployment_history(id),
          success INTEGER NOT NULL,
          executed_statements INTEGER NOT NULL DEFAULT 0,
          total_statements INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          executed_by TEXT,
          executed_by_email TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_deployment_history_conn ON deployment_history(connection_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_deployment_history_project ON deployment_history(project_id);
      `);
    },
  },
  {
    version: 14,
    name: "error_log table",
    up: (db) => {
      // Aggregated errors an operator can actually look at — see
      // `shared/errorLog.ts`. Row-count-capped rather than date-retained like
      // `audit_log`: this isn't a compliance trail, just a debugging aid, so a
      // fixed cap (trimmed on write) is enough and needs no new configuration.
      db.exec(`
        CREATE TABLE IF NOT EXISTS error_log (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          source TEXT NOT NULL,
          message TEXT NOT NULL,
          stack TEXT,
          context TEXT,
          user_id TEXT,
          user_email TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at DESC);
      `);
    },
  },
  {
    version: 15,
    name: "api_keys table",
    up: (db) => {
      // Backs the `/api/v1` public API (Phase 21). A key authenticates *as*
      // the user who created it — `user_id` is who `getEffectivePermission`
      // checks against, same as a session — with an optional narrower scope
      // list and an optional single-project restriction on top. Only the
      // SHA-256 hash is stored (`key_hash`, unique so a lookup is a direct
      // index hit); `key_prefix` is the first chars of the plaintext key kept
      // around purely so a listing UI can show "adb_3f9a…" without ever
      // storing or re-deriving the whole secret.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          last_used_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
      `);
    },
  },
  {
    version: 16,
    name: "password_reset_tokens table",
    up: (db) => {
      // Self-service "forgot password" (Phase 19). Same storage rule as
      // `api_keys`: only the SHA-256 of the emailed token is kept, so a copy
      // of the database (a backup, a stolen disk) can't be turned into a
      // working reset link. Single-use via `used_at`, claimed with a
      // conditional UPDATE the same way `invitations.accepted_at` is.
      db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
      `);
    },
  },
  {
    version: 17,
    name: "project_webhooks + webhook_deliveries tables",
    up: (db) => {
      // Outgoing webhooks (Phase 21). `secret_encrypted` signs every payload
      // (HMAC) and is encrypted at rest with ATHANORDB_SECRET like connection
      // credentials — it has to be recoverable to sign with, so hashing isn't
      // an option. `webhook_deliveries` doubles as the retry queue: a pending
      // row with a due `next_attempt_at` is picked up by the worker, so
      // retries survive a restart.
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_webhooks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'json',
          events TEXT NOT NULL,
          secret_encrypted TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          disabled_reason TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_project_webhooks_project ON project_webhooks(project_id);

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhook_id TEXT NOT NULL REFERENCES project_webhooks(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,
          last_error TEXT,
          response_status INTEGER,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
      `);
    },
  },
  {
    version: 18,
    name: "db_connections + project_connection_links (connections become global)",
    up: (db) => {
      // A connection used to belong to exactly one project. It is now an
      // instance-level object the global admin manages, attached to any number
      // of projects through a link table. Ids are preserved on the way over, so
      // `deployment_history.connection_id` keeps pointing at the same thing.
      // `origin` remembers which side created a row: one that came from a
      // project is still cleaned up with its last project, an admin-created one
      // only ever goes when an admin deletes it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS db_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          engine TEXT NOT NULL,
          environment TEXT,
          config_encrypted TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          origin TEXT NOT NULL DEFAULT 'admin',
          read_only INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_status TEXT,
          last_checked_at TEXT,
          last_version TEXT,
          last_latency_ms INTEGER,
          last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS project_connection_links (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          connection_id TEXT NOT NULL REFERENCES db_connections(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, connection_id)
        );
        CREATE INDEX IF NOT EXISTS idx_project_connection_links_conn ON project_connection_links(connection_id);
      `);
      const legacy = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_connections'")
        .get();
      if (!legacy) return;
      db.exec(`
        INSERT OR IGNORE INTO db_connections (id, name, engine, environment, config_encrypted, origin, created_at, updated_at)
          SELECT id, name, engine, environment, config_encrypted, 'project', created_at, updated_at
            FROM project_connections WHERE project_id IN (SELECT id FROM projects);
        INSERT OR IGNORE INTO project_connection_links (project_id, connection_id, created_at)
          SELECT project_id, id, created_at FROM project_connections WHERE project_id IN (SELECT id FROM projects);
      `);
      // `deployment_history.connection_id` is a foreign key to the table being
      // retired, and better-sqlite3 enforces foreign keys: dropping
      // `project_connections` first would both null every history row's
      // connection (ON DELETE SET NULL) and leave the history table pointing
      // at a table that no longer exists. So history is rebuilt against
      // `db_connections` *before* the old table goes.
      db.exec(`
        CREATE TABLE deployment_history_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          connection_id TEXT REFERENCES db_connections(id) ON DELETE SET NULL,
          connection_name TEXT NOT NULL,
          environment TEXT,
          engine TEXT NOT NULL,
          sql TEXT NOT NULL,
          rollback_sql TEXT,
          rollback_of TEXT REFERENCES deployment_history_new(id),
          success INTEGER NOT NULL,
          executed_statements INTEGER NOT NULL DEFAULT 0,
          total_statements INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          executed_by TEXT,
          executed_by_email TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO deployment_history_new
          SELECT id, project_id,
                 CASE WHEN connection_id IN (SELECT id FROM db_connections) THEN connection_id END,
                 connection_name, environment, engine, sql, rollback_sql, rollback_of, success,
                 executed_statements, total_statements, error, executed_by, executed_by_email, created_at
            FROM deployment_history ORDER BY rowid;
        DROP TABLE deployment_history;
        ALTER TABLE deployment_history_new RENAME TO deployment_history;
        CREATE INDEX IF NOT EXISTS idx_deployment_history_conn ON deployment_history(connection_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_deployment_history_project ON deployment_history(project_id);
        DROP TABLE project_connections;
      `);
    },
  },
  {
    version: 19,
    name: "admin_query_history table",
    up: (db) => {
      // What an admin ran through the SQL console, for their own recall — the
      // audit log keeps the accountable (and shorter) record. Row-capped per
      // user on write, like `error_log`. Never stores result rows.
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_query_history (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          database_name TEXT,
          sql TEXT NOT NULL,
          read_only INTEGER NOT NULL DEFAULT 1,
          success INTEGER NOT NULL,
          row_count INTEGER,
          duration_ms INTEGER,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_admin_query_history_conn ON admin_query_history(connection_id, user_id, created_at DESC);
      `);
    },
  },
  {
    version: 20,
    name: "table_locks table",
    up: (db) => {
      // Keyed by the table's id in the project document, not its name: the id
      // survives a rename, the DBML round trip and a history restore.
      // `table_name` is the name when the lock was written, for the audit
      // trail and for a lock whose table is momentarily absent. No foreign key
      // on `locked_by`: deleting an account must not lift the locks it placed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS table_locks (
          project_id TEXT NOT NULL,
          table_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          level TEXT NOT NULL,
          authority TEXT NOT NULL DEFAULT 'project',
          reason TEXT,
          locked_by TEXT,
          locked_by_name TEXT,
          locked_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, table_id)
        );
      `);
    },
  },
  {
    version: 21,
    name: "structure policy: instance_settings table, db_connections.structure_policy",
    up: (db) => {
      // `instance_settings` is a plain key → JSON store for what an
      // administrator sets for the whole instance. First tenant: the default
      // structure policy. No row means "the built-in default".
      db.exec(`
        CREATE TABLE IF NOT EXISTS instance_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // NULL `structure_policy` = follow the instance default; the SQL flag
      // only means something next to a non-NULL policy.
      const columns = db.prepare("PRAGMA table_info(db_connections)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "structure_policy")) {
        db.exec("ALTER TABLE db_connections ADD COLUMN structure_policy TEXT");
      }
      if (!columns.some((c) => c.name === "structure_policy_sql")) {
        db.exec("ALTER TABLE db_connections ADD COLUMN structure_policy_sql INTEGER NOT NULL DEFAULT 1");
      }
    },
  },
  {
    version: 22,
    name: "drift: schema_fingerprints table, project_connection_links.out_of_schema_at",
    up: (db) => {
      // One reference per (project, connection): the database as it stood
      // after the last deployment or pull. `snapshot_json` is the fingerprint
      // itself (canonical structure, no data), kept so a later check can say
      // *which* tables changed, not only that something did.
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_fingerprints (
          project_id TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          taken_at TEXT NOT NULL DEFAULT (datetime('now')),
          source TEXT NOT NULL,
          hash TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          PRIMARY KEY (project_id, connection_id)
        );
      `);
      const columns = db.prepare("PRAGMA table_info(project_connection_links)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "out_of_schema_at")) {
        db.exec("ALTER TABLE project_connection_links ADD COLUMN out_of_schema_at TEXT");
      }
      if (!columns.some((c) => c.name === "out_of_schema_detail")) {
        db.exec("ALTER TABLE project_connection_links ADD COLUMN out_of_schema_detail TEXT");
      }
    },
  },
  {
    version: 23,
    name: "environments table, db_connections.environment_id",
    up: (db) => {
      // The deployment chain (DEV › … › Prod) as configured stages instead of a
      // free-text label on each connection. `db_connections.environment` stays,
      // as the stage's name kept in step with it: deployment history, webhooks
      // and drift already read it as a snapshot, and need nothing new.
      db.exec(`
        CREATE TABLE IF NOT EXISTS environments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          color TEXT NOT NULL,
          protection TEXT NOT NULL DEFAULT 'free',
          is_production INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_production ON environments(is_production) WHERE is_production = 1;
      `);
      const columns = db.prepare("PRAGMA table_info(db_connections)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "environment_id")) {
        db.exec("ALTER TABLE db_connections ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL");
      }
      if ((db.prepare("SELECT COUNT(*) AS n FROM environments").get() as { n: number }).n > 0) return;

      // Every label already in use becomes a stage, so no connection loses
      // what it said. Order and production flag are a best guess from the
      // name (frozen here, on purpose: a migration must not change behaviour
      // when the app's own heuristics do); an administrator corrects it in
      // Admin → Environnements. An instance with no labels gets DEV › Staging › Prod.
      const labels = (
        db
          .prepare("SELECT DISTINCT TRIM(environment) AS label FROM db_connections WHERE TRIM(COALESCE(environment, '')) <> ''")
          .all() as { label: string }[]
      ).map((row) => row.label);
      const isProd = (label: string) => /\bprod(uction)?\b/i.test(label) && !/(pre|non|not)[-_ ]?prod/i.test(label);
      const rank = (label: string) =>
        isProd(label) || /\blive\b/i.test(label) ? 2 : /\b(dev|develop|development|local)\b/i.test(label) ? 0 : 1;
      const color = (label: string) => (rank(label) === 2 ? "red" : rank(label) === 0 ? "green" : "amber");

      const seen = new Map<string, string>();
      for (const label of labels) if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
      const stages = labels.length
        ? [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        : ["DEV", "Staging", "Prod"];
      const production = stages.find(isProd);

      const insert = db.prepare(
        "INSERT INTO environments (id, name, color, protection, is_production, position) VALUES (?, ?, ?, ?, ?, ?)",
      );
      stages.forEach((name, position) => {
        const id = crypto.randomUUID();
        const prod = name === production;
        insert.run(id, name, color(name), prod ? "protected" : "free", prod ? 1 : 0, position);
        db.prepare(
          "UPDATE db_connections SET environment_id = ?, environment = ? WHERE LOWER(TRIM(environment)) = LOWER(?)",
        ).run(id, name, name);
      });
    },
  },
  {
    version: 24,
    name: "deployment_history.accepted_risks, risk_note",
    up: (db) => {
      // What the plan risked and what was chosen for each risk (JSON array of
      // `AcceptedRisk`), and the free-text reason given — so "who accepted
      // dropping orders.note, and why" is answered by the history itself.
      const columns = db.prepare("PRAGMA table_info(deployment_history)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "accepted_risks")) {
        db.exec("ALTER TABLE deployment_history ADD COLUMN accepted_risks TEXT");
      }
      if (!columns.some((c) => c.name === "risk_note")) {
        db.exec("ALTER TABLE deployment_history ADD COLUMN risk_note TEXT");
      }
    },
  },
  {
    version: 25,
    name: "table_seeds table, deployment_history.seed_report",
    up: (db) => {
      // A table's initial rows, as the CSV it was given (`content`, capped
      // at SEED_MAX_BYTES) and how to read it (`options_json`: separator,
      // header, column mapping by field id, mode). Keyed by table id, like
      // table locks, so a rename keeps its seed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS table_seeds (
          project_id TEXT NOT NULL,
          table_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'csv',
          content TEXT NOT NULL,
          options_json TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          updated_by TEXT,
          updated_by_name TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, table_id)
        );
      `);
      // What each seeded table got during a deployment (JSON array of `SeedResult`).
      const columns = db.prepare("PRAGMA table_info(deployment_history)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "seed_report")) {
        db.exec("ALTER TABLE deployment_history ADD COLUMN seed_report TEXT");
      }
    },
  },
  {
    version: 26,
    name: "generator_configs table",
    up: (db) => {
      // How a table's test data is generated (rows, seed, locale, a generator
      // per field id) — kept so a run can be repeated and adjusted.
      db.exec(`
        CREATE TABLE IF NOT EXISTS generator_configs (
          project_id TEXT NOT NULL,
          table_id TEXT NOT NULL,
          config_json TEXT NOT NULL,
          updated_by_name TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, table_id)
        );
      `);
    },
  },
  {
    version: 27,
    name: "audit_log.project_id, connection_id, correlation_id",
    up: (db) => {
      // The activity view filters by project and by database, and groups what
      // one request did. Older rows get the project or connection their target
      // already named; the rest stay NULL (unknown, not "none").
      const columns = db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[];
      for (const column of ["project_id", "connection_id", "correlation_id"]) {
        if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE audit_log ADD COLUMN ${column} TEXT`);
      }
      db.exec(`
        UPDATE audit_log SET project_id = target_id WHERE project_id IS NULL AND target_type = 'project';
        UPDATE audit_log SET connection_id = target_id WHERE connection_id IS NULL AND target_type = 'connection';
        CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_connection ON audit_log(connection_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
      `);
    },
  },
  {
    version: 28,
    name: "monitor_settings and drift_events tables",
    up: (db) => {
      // Per project: whether its databases are watched, how often, what to
      // ignore, and when they were last read. Off unless someone turns it on.
      db.exec(`
        CREATE TABLE IF NOT EXISTS monitor_settings (
          project_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          interval_minutes INTEGER NOT NULL DEFAULT 60,
          ignore_json TEXT NOT NULL DEFAULT '[]',
          last_checked_at TEXT,
          updated_by_name TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS drift_events (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          detected_at TEXT NOT NULL DEFAULT (datetime('now')),
          live_hash TEXT,
          added_json TEXT NOT NULL DEFAULT '[]',
          removed_json TEXT NOT NULL DEFAULT '[]',
          changed_json TEXT NOT NULL DEFAULT '[]',
          error TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_drift_events_project ON drift_events(project_id, detected_at DESC);
      `);
    },
  },
  {
    version: 29,
    name: "backups table, deployment_history.backup_id",
    up: (db) => {
      // Logical backups of connected databases. The rows live in a file
      // (`storage_ref` is not needed: the file is named after the id); this is
      // what the file holds, how it went, and the file's own key — encrypted
      // with the instance secret, so rotating that secret never rewrites a file.
      db.exec(`
        CREATE TABLE IF NOT EXISTS backups (
          id TEXT PRIMARY KEY,
          connection_id TEXT,
          connection_name TEXT NOT NULL,
          engine TEXT NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          scope_json TEXT,
          tables_json TEXT NOT NULL DEFAULT '[]',
          tables_total INTEGER NOT NULL DEFAULT 0,
          rows INTEGER NOT NULL DEFAULT 0,
          size_bytes INTEGER,
          checksum TEXT,
          key_encrypted TEXT,
          error TEXT,
          note TEXT,
          created_by TEXT,
          created_by_name TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT,
          pinned INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_backups_connection ON backups(connection_id, started_at DESC);
      `);
      // The safety backup taken just before a deployment, when there was one.
      const columns = db.prepare("PRAGMA table_info(deployment_history)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "backup_id")) {
        db.exec("ALTER TABLE deployment_history ADD COLUMN backup_id TEXT");
      }
    },
  },
];

/** Applies every migration above the database's current `user_version`, each in its own transaction, in order. */
export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      // Interpolated rather than bound: PRAGMA doesn't accept `?` parameters,
      // and `migration.version` is a compile-time constant from the array
      // above, never user input.
      db.pragma(`user_version = ${migration.version}`);
    })();
    console.log(`[db] applied migration ${migration.version}: ${migration.name}`);
  }
}
