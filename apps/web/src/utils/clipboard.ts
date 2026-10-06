/**
 * Copy text to the clipboard, everywhere. `navigator.clipboard` only exists in a secure context
 * (not plain HTTP on a LAN) and can reject, so `execCommand` is the fallback. Returns whether the
 * text made it, so callers confirm only when there is something to confirm.
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
