/**
 * `crypto.randomUUID()` is gated behind `window.isSecureContext` in every
 * browser — it throws/`is not a function` on a plain `http://` origin that
 * isn't `localhost`. AthanorDB is explicitly meant to be reached over plain
 * HTTP on a LAN (see README), so every id generated on the canvas (tables,
 * fields, indexes, zones, notes, enums, refs, comments, groups) went through
 * this instead of the raw global, once that surfaced from a LAN deployment.
 *
 * Falls back to building a v4 UUID from `crypto.getRandomValues` (available
 * in insecure contexts, unlike `randomUUID`), and finally to `Math.random`
 * for environments with no `crypto` at all (very old browsers, some test
 * runners). Not cryptographically significant here — these ids only need to
 * be unique within a project's Yjs doc, never security tokens.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort fallback: not RFC-compliant randomness, but still unique
  // enough for a client-generated doc-local id.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
