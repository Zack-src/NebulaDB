import crypto from "node:crypto";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";

/**
 * Read-only links to a project's diagram and data dictionary for people with
 * no account. Same secret handling as API keys (`apiKeys/repository.ts`): the
 * token is 32 random bytes, only its SHA-256 is stored, it is returned in full
 * once at creation, and the lists show a short prefix. Unlike an API key it is
 * also kept encrypted with the instance secret (`token_encrypted`), so an
 * administrator can copy a link again — see `revealShareToken`.
 */

export const SHARE_CONTENTS = ["diagram", "dictionary", "both"] as const;
export type ShareContent = (typeof SHARE_CONTENTS)[number];

export function isShareContent(value: unknown): value is ShareContent {
  return typeof value === "string" && (SHARE_CONTENTS as readonly string[]).includes(value);
}

/** What a link left alone does: a month, long enough to send it to someone and short enough to be forgotten safely. */
export const DEFAULT_EXPIRY_DAYS = 30;
/** No link without an end: a forgotten one would publish the schema for good. */
export const MAX_EXPIRY_DAYS = 365;
/** Live (neither revoked nor expired) links per project. */
export const MAX_ACTIVE_LINKS_PER_PROJECT = 50;

const TOKEN_PREFIX = "nds";
/** `nds_` + 43 base64url characters: anything else is refused before the database is asked. */
const TOKEN_SHAPE = /^nds_[A-Za-z0-9_-]{43}$/;
/** As for API keys: enough to tell links apart in a list, never enough to guess the rest. */
const DISPLAY_PREFIX_LENGTH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const SETTING_KEY = "share_links";

export type ShareLinkStatus = "active" | "expired" | "revoked";

export interface ShareLinkSummary {
  id: string;
  projectId: string;
  label: string;
  tokenPrefix: string;
  /** Whether an administrator can still copy the full address (false for links made before it was kept). */
  copyable: boolean;
  shows: ShareContent;
  status: ShareLinkStatus;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

/** An instance administrator's view: every project's links, with the project's name. */
export interface InstanceShareLinkSummary extends ShareLinkSummary {
  projectName: string;
}

interface ShareLinkRow {
  id: string;
  project_id: string;
  label: string;
  token_prefix: string;
  copyable: boolean;
  shows: ShareContent;
  created_at: string;
  created_by_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  project_name?: string;
}

const SUMMARY_COLUMNS = `s.id, s.project_id, s.label, s.token_prefix, (s.token_encrypted IS NOT NULL) AS copyable, s.shows, s.created_at, s.expires_at, s.revoked_at,
  s.view_count, s.last_viewed_at, COALESCE(u.display_name, u.email) AS created_by_name`;

function statusOf(row: { revoked_at: string | null; expires_at: string }, now: string): ShareLinkStatus {
  if (row.revoked_at) return "revoked";
  return row.expires_at > now ? "active" : "expired";
}

function toSummary(row: ShareLinkRow, now: string): ShareLinkSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    copyable: row.copyable === true,
    shows: row.shows,
    status: statusOf(row, now),
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: Number(row.view_count),
    lastViewedAt: row.last_viewed_at,
  };
}

/** SHA-256, not a slow hash: the token is 256 random bits, and every view looks one up. */
export function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---- Instance setting --------------------------------------------------------

/** Off unless an instance administrator turned it on. Turning it off stops every link without deleting any. */
export async function shareLinksEnabled(): Promise<boolean> {
  const row = (await db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(SETTING_KEY)) as
    { value: string } | undefined;
  if (!row) return false;
  try {
    return (JSON.parse(row.value) as { enabled?: unknown }).enabled === true;
  } catch {
    // A hand-edited or half-written row must not publish anything.
    return false;
  }
}

export async function setShareLinksEnabled(enabled: boolean, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(SETTING_KEY, JSON.stringify({ enabled }), userId, new Date().toISOString());
}

// ---- Management ----------------------------------------------------------------

export interface CreatedShareLink {
  link: ShareLinkSummary;
  /** The full token — returned once, at creation, and never again. */
  token: string;
}

export async function createShareLink(input: {
  projectId: string;
  userId: string;
  label: string;
  shows: ShareContent;
  expiresInDays: number;
}): Promise<CreatedShareLink> {
  const id = crypto.randomUUID();
  const token = `${TOKEN_PREFIX}_${crypto.randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const createdAt = now.toISOString();
  // Without NEBULADB_SECRET nothing can be encrypted: the link works, it just cannot be copied again.
  let tokenEncrypted: string | null;
  try {
    tokenEncrypted = encryptPayload(token);
  } catch {
    tokenEncrypted = null;
  }
  const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO share_links (id, project_id, label, token_hash, token_prefix, token_encrypted, shows, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.label,
      hashShareToken(token),
      token.slice(0, DISPLAY_PREFIX_LENGTH),
      tokenEncrypted,
      input.shows,
      input.userId,
      createdAt,
      expiresAt,
    );
  return { token, link: (await getShareLink(id))! };
}

export async function getShareLink(id: string): Promise<ShareLinkSummary | null> {
  const row = (await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM share_links s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?`)
    .get(id)) as ShareLinkRow | undefined;
  return row ? toSummary(row, new Date().toISOString()) : null;
}

/** A project's links, newest first — revoked and expired ones included, so the list keeps their trace. */
export async function listProjectShareLinks(projectId: string): Promise<ShareLinkSummary[]> {
  const now = new Date().toISOString();
  const rows = (await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM share_links s LEFT JOIN users u ON u.id = s.created_by
        WHERE s.project_id = ? ORDER BY s.created_at DESC`,
    )
    .all(projectId)) as ShareLinkRow[];
  return rows.map((row) => toSummary(row, now));
}

/**
 * The full token of a link that still works, for an instance administrator who
 * needs to copy it again; `null` when the link is revoked, expired, unknown or
 * was made without its token being kept.
 */
export async function revealShareToken(id: string): Promise<{ token: string; link: ShareLinkSummary } | null> {
  const row = (await db
    .prepare("SELECT token_encrypted FROM share_links WHERE id = ? AND revoked_at IS NULL AND expires_at > ?")
    .get(id, new Date().toISOString())) as { token_encrypted: string | null } | undefined;
  if (!row?.token_encrypted) return null;
  const link = await getShareLink(id);
  return link ? { token: decryptPayload<string>(row.token_encrypted), link } : null;
}

/** Every link of the instance, newest first, for its administrators. */
export async function listAllShareLinks(): Promise<InstanceShareLinkSummary[]> {
  const now = new Date().toISOString();
  const rows = (await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, p.name AS project_name
         FROM share_links s
         JOIN projects p ON p.id = s.project_id
         LEFT JOIN users u ON u.id = s.created_by
        ORDER BY s.created_at DESC`,
    )
    .all()) as ShareLinkRow[];
  return rows.map((row) => ({ ...toSummary(row, now), projectName: row.project_name ?? "" }));
}

export async function countActiveShareLinks(projectId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM share_links WHERE project_id = ? AND revoked_at IS NULL AND expires_at > ?")
    .get(projectId, new Date().toISOString())) as { n: number };
  return Number(row.n);
}

/**
 * Revokes a link that is not revoked yet. `projectId` scopes it to one
 * project (a project administrator); `null` is an instance administrator's
 * revoke of any link. The revoked link, or `null` when there was none to revoke.
 */
export async function revokeShareLink(
  id: string,
  userId: string,
  projectId: string | null,
): Promise<ShareLinkSummary | null> {
  const now = new Date().toISOString();
  const changes =
    projectId === null
      ? (
          await db
            .prepare("UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL")
            .run(now, userId, id)
        ).changes
      : (
          await db
            .prepare(
              `UPDATE share_links SET revoked_at = ?, revoked_by = ?
                WHERE id = ? AND project_id = ? AND revoked_at IS NULL`,
            )
            .run(now, userId, id, projectId)
        ).changes;
  return changes > 0 ? await getShareLink(id) : null;
}

// ---- Public resolution -----------------------------------------------------------

export interface ResolvedShareLink {
  linkId: string;
  projectId: string;
  projectName: string;
  shows: ShareContent;
  expiresAt: string;
}

/**
 * The link a token opens, or `null` — one `null` for every reason (malformed,
 * unknown, revoked, expired, project in the trash, links turned off on the
 * instance), so the caller cannot answer differently even by mistake.
 */
export async function resolveShareToken(token: string): Promise<ResolvedShareLink | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  if (!(await shareLinksEnabled())) return null;
  const row = (await db
    .prepare(
      `SELECT s.id, s.project_id, s.shows, s.expires_at, p.name AS project_name
         FROM share_links s JOIN projects p ON p.id = s.project_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND p.status <> 'trashed'`,
    )
    .get(hashShareToken(token), new Date().toISOString())) as
    { id: string; project_id: string; shows: ShareContent; expires_at: string; project_name: string } | undefined;
  if (!row) return null;
  return {
    linkId: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    shows: row.shows,
    expiresAt: row.expires_at,
  };
}

/** One more view, and when. Nothing about the viewer is kept. */
export async function recordShareView(linkId: string): Promise<void> {
  await db
    .prepare("UPDATE share_links SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?")
    .run(new Date().toISOString(), linkId);
}
