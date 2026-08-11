/**
 * Typed localStorage access.
 *
 * Every read is wrapped: localStorage throws in private-browsing modes and on
 * quota, and a preference failing to load must never take a screen down with
 * it. Callers get the default instead.
 */

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A preference that can't be persisted still applies for this session.
  }
}

export function readBoolean(key: string, fallback: boolean): boolean {
  const raw = readString(key);
  return raw === null ? fallback : raw === "true";
}

export function writeBoolean(key: string, value: boolean): void {
  writeString(key, String(value));
}

export function readNumberInRange(key: string, min: number, max: number, fallback: number): number {
  const parsed = Number(readString(key));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function readJson<T>(key: string): T | null {
  const raw = readString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}
