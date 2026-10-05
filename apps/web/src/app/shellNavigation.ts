export type ShellView = "app" | "bases" | "admin" | "settings";

/** Global destinations use hashes so existing project/invitation URLs and server fallbacks remain valid. */
export function shellViewFromHash(hash: string, isAdmin: boolean): ShellView {
  const value = hash.replace(/^#/, "");
  if (value === "settings" || value === "bases") return value;
  if (value === "admin" && isAdmin) return value;
  return "app";
}

export function shellHash(view: ShellView): string {
  return view === "app" ? "" : `#${view}`;
}
