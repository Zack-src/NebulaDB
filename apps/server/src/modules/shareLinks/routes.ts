import { projectToSvg } from "@nebuladb/dbml-engine";
import type { FastifyInstance } from "fastify";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAdmin } from "../../shared/guards.js";
import { requireSessionUser } from "../apiKeys/auth.js";
import {
  DEFAULT_EXPIRY_DAYS,
  MAX_ACTIVE_LINKS_PER_PROJECT,
  MAX_EXPIRY_DAYS,
  countActiveShareLinks,
  createShareLink,
  isShareContent,
  listAllShareLinks,
  listProjectShareLinks,
  recordShareView,
  resolveShareToken,
  revokeShareLink,
  setShareLinksEnabled,
  shareLinksEnabled,
  type ShareLinkSummary,
} from "./repository.js";
import { publicDictionary } from "./view.js";

const MAX_LABEL_LENGTH = 100;

/**
 * Per IP, on each public route. A page view is one call to each; the token is
 * 256 random bits, so this is about load, not about guessing.
 */
const PUBLIC_RATE_LIMIT = { exposeHeadRoute: false, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

function parseExpiry(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_EXPIRY_DAYS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_EXPIRY_DAYS) {
    throw new ApiError("SHARE_LINK_EXPIRY_INVALID");
  }
  return value;
}

const describe = (link: ShareLinkSummary) => `${link.label} (${link.tokenPrefix}…, ${link.shows})`;

/**
 * Share links: a project administrator's management routes, the instance
 * administrator's, and the public routes a link opens.
 *
 * Management is reachable from a browser session only, never with an API
 * key — same reasoning as minting API keys: a leaked key must not be able to
 * publish the schema to the world.
 *
 * The public routes take nothing but the token. `app.ts` keeps them away
 * from sessions altogether (no cookie read, none set) and adds the private
 * headers; here every failure is the same `SHARE_LINK_NOT_FOUND`, whatever
 * the reason.
 */
export function registerShareLinkRoutes(app: FastifyInstance): void {
  // ---- Project administrator ---------------------------------------------------

  app.get("/api/projects/:id/share-links", async (req) => {
    requireSessionUser(req);
    const { id } = req.params as { id: string };
    await requireProjectAdmin(req, id);
    return { enabled: await shareLinksEnabled(), links: await listProjectShareLinks(id) };
  });

  /** The token is returned here once and never again. */
  app.post("/api/projects/:id/share-links", async (req, reply) => {
    requireSessionUser(req);
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    if (!(await shareLinksEnabled())) throw new ApiError("SHARE_LINKS_DISABLED");

    const body = (req.body ?? {}) as { label?: unknown; shows?: unknown; expiresInDays?: unknown };
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) throw new ApiError("SHARE_LINK_LABEL_REQUIRED");
    if (label.length > MAX_LABEL_LENGTH) throw new ApiError("NAME_TOO_LONG");
    const shows = body.shows ?? "both";
    if (!isShareContent(shows)) throw new ApiError("SHARE_LINK_CONTENT_INVALID");
    const expiresInDays = parseExpiry(body.expiresInDays);
    if ((await countActiveShareLinks(id)) >= MAX_ACTIVE_LINKS_PER_PROJECT)
      throw new ApiError("SHARE_LINK_LIMIT_REACHED");

    const created = await createShareLink({ projectId: id, userId: user.id, label, shows, expiresInDays });
    await auditUser(
      user,
      "share.create",
      { type: "project", id },
      `${describe(created.link)}, expires ${created.link.expiresAt}`,
      req,
    );
    return reply.code(201).send(created);
  });

  app.delete("/api/projects/:id/share-links/:linkId", async (req) => {
    requireSessionUser(req);
    const { id, linkId } = req.params as { id: string; linkId: string };
    const { user } = await requireProjectAdmin(req, id);
    const link = await revokeShareLink(linkId, user.id, id);
    if (!link) throw new ApiError("SHARE_LINK_NOT_FOUND");
    await auditUser(user, "share.revoke", { type: "project", id }, describe(link), req);
    return { link };
  });

  // ---- Instance administrator ----------------------------------------------------

  app.get("/api/admin/share-links", async (req) => {
    requireSessionUser(req);
    requireAdmin(req);
    return { enabled: await shareLinksEnabled(), links: await listAllShareLinks() };
  });

  app.delete("/api/admin/share-links/:linkId", async (req) => {
    requireSessionUser(req);
    const user = requireAdmin(req);
    const { linkId } = req.params as { linkId: string };
    const link = await revokeShareLink(linkId, user.id, null);
    if (!link) throw new ApiError("SHARE_LINK_NOT_FOUND");
    await auditUser(user, "share.revoke", { type: "project", id: link.projectId }, describe(link), req);
    return { link };
  });

  app.get("/api/admin/settings/share-links", async (req) => {
    requireAdmin(req);
    return { enabled: await shareLinksEnabled() };
  });

  /** Off stops every link at once; on again brings back those neither revoked nor expired meanwhile. */
  app.put("/api/admin/settings/share-links", async (req) => {
    requireSessionUser(req);
    const user = requireAdmin(req);
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") throw new ApiError("SHARE_LINK_SETTING_INVALID");
    const previous = await shareLinksEnabled();
    await setShareLinksEnabled(enabled, user.id);
    await auditUser(user, "instance.share_links", null, `${previous ? "on" : "off"} -> ${enabled ? "on" : "off"}`, req);
    return { enabled };
  });

  // ---- Public ----------------------------------------------------------------------

  /** What the page shows, read from the project as it is now. Counts one view. */
  app.get("/api/share/:token", PUBLIC_RATE_LIMIT, async (req) => {
    const { token } = req.params as { token: string };
    const link = await resolveShareToken(token);
    if (!link) throw new ApiError("SHARE_LINK_NOT_FOUND");
    await recordShareView(link.linkId);
    const project = await readProjectReadOnly(link.projectId, link.projectName);
    return {
      projectName: link.projectName,
      shows: link.shows,
      expiresAt: link.expiresAt,
      dictionary: link.shows === "diagram" ? null : publicDictionary(project),
    };
  });

  app.get("/api/share/:token/diagram.svg", PUBLIC_RATE_LIMIT, async (req, reply) => {
    const { token } = req.params as { token: string };
    const link = await resolveShareToken(token);
    if (!link || link.shows === "dictionary") throw new ApiError("SHARE_LINK_NOT_FOUND");
    const project = await readProjectReadOnly(link.projectId, link.projectName);
    // Opened on its own, the document may run nothing and load nothing.
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    reply.type("image/svg+xml; charset=utf-8");
    return projectToSvg(project);
  });
}
