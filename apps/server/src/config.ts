/**
 * Single place where environment configuration is read, validated and
 * documented. Everything else imports `config` rather than touching
 * `process.env`, so a malformed value fails loudly at boot instead of silently
 * falling back to a default halfway through a request.
 */

const isProduction = process.env.NODE_ENV === "production";

function fail(message: string): never {
  console.error(`[config] ${message}`);
  process.exit(1);
}

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === "") return 3001;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`PORT must be an integer between 1 and 65535 (got ${JSON.stringify(raw)})`);
  }
  return port;
}

function readCookieSecure(): boolean {
  const raw = process.env.ATHANORDB_COOKIE_SECURE;
  if (raw === undefined || raw.trim() === "") {
    // Self-hosted deployments may legitimately run plain HTTP on a LAN, so this
    // can't just default to true — but silently shipping non-`Secure` session
    // cookies in production is exactly the kind of thing nobody notices.
    if (isProduction) {
      console.warn(
        "[config] ATHANORDB_COOKIE_SECURE is not set — session cookies will NOT be marked Secure. " +
          'Set ATHANORDB_COOKIE_SECURE=true when running behind TLS, or =false to silence this warning.',
      );
    }
    return false;
  }
  if (raw !== "true" && raw !== "false") {
    fail(`ATHANORDB_COOKIE_SECURE must be "true" or "false" (got ${JSON.stringify(raw)})`);
  }
  return raw === "true";
}

function readSizeMb(name: string, fallbackMb: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallbackMb * 1024 * 1024;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0 || mb > 512) {
    fail(`${name} must be a size in megabytes between 0 and 512 (got ${JSON.stringify(raw)})`);
  }
  return Math.round(mb * 1024 * 1024);
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Log verbosity. Previously fixed at pino's default (`info`), with no way to
 * quieten a busy instance or to turn up detail while diagnosing one without
 * editing code and redeploying.
 */
function readLogLevel(): LogLevel {
  const raw = process.env.ATHANORDB_LOG_LEVEL;
  if (raw === undefined || raw.trim() === "") return "info";
  const level = raw.trim().toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    fail(`ATHANORDB_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")} (got ${JSON.stringify(raw)})`);
  }
  return level as LogLevel;
}

/**
 * Hours between automatic backups. `0` (the default) leaves them off — an
 * operator who has their own snapshot/volume strategy shouldn't get a second,
 * unasked-for one writing into the container.
 */
function readBackupIntervalHours(): number {
  const raw = process.env.ATHANORDB_BACKUP_INTERVAL_HOURS;
  if (raw === undefined || raw.trim() === "") return 0;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30) {
    fail(`ATHANORDB_BACKUP_INTERVAL_HOURS must be a number of hours between 0 and 720 (got ${JSON.stringify(raw)})`);
  }
  return hours;
}

/** How many timestamped backup directories to keep. Unbounded backups fill the disk the database lives on. */
function readBackupKeep(): number {
  const raw = process.env.ATHANORDB_BACKUP_KEEP;
  if (raw === undefined || raw.trim() === "") return 7;
  const keep = Number(raw);
  if (!Number.isInteger(keep) || keep < 1 || keep > 1000) {
    fail(`ATHANORDB_BACKUP_KEEP must be an integer between 1 and 1000 (got ${JSON.stringify(raw)})`);
  }
  return keep;
}

/**
 * How long audit entries are kept. An audit trail with no retention grows
 * forever, which is both an operational problem and a hard one to defend under
 * GDPR — "we keep a record of who did what, indefinitely, because nobody chose
 * a number" is not a retention policy. A year covers the incident-response and
 * compliance cases the log exists for; `0` disables the purge for operators
 * whose own rules require keeping everything.
 */
function readAuditRetentionDays(): number {
  const raw = process.env.ATHANORDB_AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return 365;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    fail(`ATHANORDB_AUDIT_RETENTION_DAYS must be an integer between 0 and 3650 (got ${JSON.stringify(raw)})`);
  }
  return days;
}

/** Extra origins allowed to make state-changing requests, on top of the app's own host. */
function readAllowedOrigins(): string[] {
  const raw = process.env.ATHANORDB_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export const config = {
  isProduction,
  port: readPort(),
  dbPath: process.env.ATHANORDB_DB_PATH ?? "./data/athanordb.sqlite",
  cookieSecure: readCookieSecure(),
  /** Max REST body — DBML/SQL imports are the big ones. */
  bodyLimit: readSizeMb("ATHANORDB_MAX_BODY_MB", 4),
  /** Max single WebSocket frame — a Yjs sync/update for a large schema. */
  wsMaxPayload: readSizeMb("ATHANORDB_MAX_WS_FRAME_MB", 8),
  allowedOrigins: readAllowedOrigins(),
  logLevel: readLogLevel(),
  /** 0 disables scheduled backups entirely. */
  backupIntervalHours: readBackupIntervalHours(),
  backupDir: process.env.ATHANORDB_BACKUP_DIR ?? "./backups",
  backupKeep: readBackupKeep(),
  /** 0 keeps audit entries indefinitely. */
  auditRetentionDays: readAuditRetentionDays(),
} as const;
