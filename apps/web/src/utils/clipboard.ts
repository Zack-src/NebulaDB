/**
 * Copy text to the clipboard, everywhere.
 *
 * `navigator.clipboard` only exists in a secure context — which a self-hosted
 * install reached over plain HTTP on a LAN address is not — so every direct
 * call site was a `TypeError` waiting for the first deployment without TLS.
 * The modern path is also permission-gated and can reject, so it is wrapped
 * too, with the legacy `execCommand` route as the fallback.
 *
 * Returns whether the text made it, so callers can show a confirmation only
 * when there is something to confirm.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or a non-secure context — fall through.
  }

  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-9999px";
    document.body.appendChild(field);
    field.select();
    // iOS Safari ignores `select()` on a readonly field without this.
    field.setSelectionRange(0, field.value.length);
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}
