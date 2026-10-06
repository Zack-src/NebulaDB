import { existsSync } from "node:fs";

/** New names take precedence, including explicitly empty values. */
export function readEnv(name: string): string | undefined {
  const legacy = name.replace(/^NEBULADB_/, "ATHANORDB_");
  return process.env[name] ?? process.env[legacy];
}

/** Keep opening an existing installation instead of silently creating an empty database. */
export function defaultDbPath(): string {
  const current = "./data/nebuladb.sqlite";
  const legacy = "./data/athanordb.sqlite";
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}
