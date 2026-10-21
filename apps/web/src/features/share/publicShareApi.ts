import type { DataDictionary } from "@nebuladb/dbml-engine";
import type { ShareContent } from "@/services/shareLinksApi";

/**
 * The only requests the public share page makes, and the only endpoints it
 * knows. Not `httpClient`: these go out with no cookie (`credentials: "omit"`)
 * so a viewer who happens to be signed in to this instance is as anonymous
 * as anyone else, with no `Referer` (the page address holds the token), and
 * never from the cache.
 */

export interface SharedView {
  projectName: string;
  shows: ShareContent;
  expiresAt: string;
  /** `null` when the link shows the diagram only. */
  dictionary: DataDictionary | null;
}

/** The token in a `/share/<token>` path, or `null` for any other path. */
export function shareTokenFromPath(pathname: string): string | null {
  const match = /^\/share\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

/** Why the page shows nothing: the link does not work (whatever the reason — the server does not say), or the network. */
export class ShareUnavailableError extends Error {
  constructor(readonly reason: "not-found" | "rate-limited" | "network") {
    super(reason);
    this.name = "ShareUnavailableError";
  }
}

const INIT: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };

async function get(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, INIT);
  } catch {
    throw new ShareUnavailableError("network");
  }
  if (res.status === 429) throw new ShareUnavailableError("rate-limited");
  if (!res.ok) throw new ShareUnavailableError("not-found");
  return res;
}

export async function fetchSharedView(token: string): Promise<SharedView> {
  return (await (await get(`/api/share/${encodeURIComponent(token)}`)).json()) as SharedView;
}

/** The server's rendering of the diagram, as SVG text. */
export async function fetchSharedDiagram(token: string): Promise<string> {
  return (await get(`/api/share/${encodeURIComponent(token)}/diagram.svg`)).text();
}
