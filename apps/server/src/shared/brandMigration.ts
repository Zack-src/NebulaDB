/** New names take precedence, including explicitly empty values. */
export function readEnv(name: string): string | undefined {
  const legacy = name.replace(/^NEBULADB_/, "ATHANORDB_");
  return process.env[name] ?? process.env[legacy];
}
