/** Object URLs are revoked on a delay rather than synchronously — long enough for any browser to have started the fetch, short enough not to leak for the session. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Hands the browser a file to save.
 *
 * `a.click()` only *dispatches* the event; the browser fetches the href
 * afterwards, on its own schedule. Revoking an object URL on the next
 * synchronous line — which is what the export dialog did — can therefore
 * invalidate it before that fetch begins, and the download silently never
 * happens. The anchor is also attached to the document first, which some
 * browsers require before they will honour `download`.
 */
export function triggerDownload(href: string, filename: string, revokeObjectUrl = false): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (revokeObjectUrl) {
    window.setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS);
  }
}
