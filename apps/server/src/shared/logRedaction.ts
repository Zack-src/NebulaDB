/**
 * A share link's token is the whole credential of the link and sits in its
 * URL (`/share/<token>`, `/api/share/<token>/…`): a log line holding it is a
 * log line anyone who reads the logs can open the schema with. Same for the
 * password-reset and invitation tokens (`/reset-password/<token>`,
 * `/invite/<token>`, `/api/invitations/<token>/accept`). Request URLs go
 * through this before they are logged or stored (`app.ts`'s request
 * serializer, the error log).
 */
const SHARE_SEGMENT = /(\/(?:share|reset-password|invite|invitations)\/)[^/?#]+/g;

export function redactShareTokens(url: string): string {
  return url.replace(SHARE_SEGMENT, "$1[redacted]");
}

/** The public page and its API: no session is read or rolled there, and every answer carries the private headers. */
export function isSharePath(url: string): boolean {
  return url.startsWith("/share/") || url.startsWith("/api/share/");
}
