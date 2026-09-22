/**
 * Focuses the element as soon as it is mounted.
 *
 * Not the native `autofocus` attribute: the browser only honours that on page
 * load, and Svelte's own handling of it only steals focus when nothing else
 * holds it — but a field inside a dialog or popover is mounted precisely
 * *because* the user just clicked something, which still has focus. Every
 * "type here now" field in the app wants the unconditional version.
 */
export function autofocus(node: HTMLElement, enabled: boolean = true) {
  if (enabled) node.focus();
}
