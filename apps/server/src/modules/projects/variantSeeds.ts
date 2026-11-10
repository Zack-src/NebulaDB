import { createHash } from "node:crypto";
import { classifyChange, type VariantChange, type VariantDecisions } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { deleteSeed, listSeedsWithContent, upsertSeed, type StoredSeed } from "../seeds/repository.js";
import { canOverrideLock, lockAuthorityOf } from "../tableLocks/access.js";
import { getTableLock } from "../tableLocks/repository.js";

/**
 * The initial data (seeds) of a variant, sent and received like the schema:
 * per table, what the source changed since the last sending, and whether the
 * other side changed it too (a conflict, the target's version kept unless the
 * source's is chosen).
 *
 * What was last sent is kept as a hash per table (`seedHashes`, in the same
 * snapshot as the schema). Only seeds kept inline travel: one kept as a file
 * stays on the server it was uploaded to, as in a project bundle.
 */

export type SeedHashes = Record<string, string>;

interface Caller {
  id: string;
  displayName: string;
}

const hashOf = (seed: StoredSeed) =>
  createHash("sha1")
    .update(JSON.stringify({ content: seed.content, options: seed.options }))
    .digest("hex");

/** The inline seeds of a project by table id. */
async function inlineSeeds(projectId: string): Promise<Map<string, StoredSeed>> {
  return new Map(
    (await listSeedsWithContent(projectId))
      .filter((seed) => seed.storage !== "file")
      .map((seed) => [seed.tableId, seed]),
  );
}

/** What a snapshot of a project records of its seeds. */
export async function seedHashesOf(projectId: string): Promise<SeedHashes> {
  const hashes: SeedHashes = {};
  for (const [tableId, seed] of await inlineSeeds(projectId)) hashes[tableId] = hashOf(seed);
  return hashes;
}

/**
 * The seed changes `source` has for `target`. `tables` is the schema the
 * target will have: a seed only goes to a table that exists there.
 * `baseline` is what was last sent; without it (a variant made before seeds
 * were tracked) nothing says who changed what, so a seed that differs counts
 * as changed on both sides.
 */
export async function planSeedSync(
  sourceId: string,
  targetId: string,
  baseline: SeedHashes | undefined,
  tables: Project["tables"],
): Promise<VariantChange[]> {
  const [source, target] = await Promise.all([inlineSeeds(sourceId), inlineSeeds(targetId)]);
  const names = new Map(tables.map((table) => [table.id, table.name]));
  const changes: VariantChange[] = [];
  for (const tableId of new Set([...source.keys(), ...target.keys(), ...Object.keys(baseline ?? {})])) {
    const name = names.get(tableId);
    if (!name) continue; // no such table on the receiving side (yet): nothing to put the data in
    const src = source.get(tableId);
    const dst = target.get(tableId);
    const srcHash = src && hashOf(src);
    const dstHash = dst && hashOf(dst);
    let verdict: ReturnType<typeof classifyChange<string>>;
    if (baseline) {
      verdict = classifyChange(baseline[tableId], srcHash, dstHash, (h) => h);
    } else if (srcHash === dstHash) {
      verdict = null;
    } else {
      const action = !dst ? "add" : !src ? "remove" : "update";
      verdict = dst && src ? { action, conflict: "variant-changed" } : { action };
    }
    if (verdict) changes.push({ key: `seed:${tableId}`, kind: "seed", label: name, tableName: name, ...verdict });
  }
  return changes;
}

/**
 * Applies the seed changes chosen (`takes`) from `source` to `target`.
 * A table under a full lock the caller cannot override is left as it is.
 * Answers how many were applied and the baseline to keep.
 */
export async function applySeedSync(
  user: Caller,
  sourceId: string,
  targetId: string,
  changes: readonly VariantChange[],
  decisions: VariantDecisions,
  tables: Project["tables"],
): Promise<{ applied: number; taken: Map<string, string | null> }> {
  const source = await inlineSeeds(sourceId);
  const held = await lockAuthorityOf(user.id, targetId);
  const taken = new Map<string, string | null>();
  let applied = 0;
  for (const change of changes) {
    if ((decisions[change.key] ?? (change.conflict ? "variant" : "base")) !== "base") continue;
    const tableId = change.key.slice("seed:".length);
    const table = tables.find((t) => t.id === tableId);
    if (!table) continue;
    const lock = await getTableLock(targetId, tableId);
    if (lock?.level === "full" && !canOverrideLock(held, lock)) continue;
    const seed = source.get(tableId);
    if (seed) {
      await upsertSeed({
        projectId: targetId,
        tableId,
        tableName: table.name,
        content: seed.content,
        options: seed.options,
        rowCount: seed.rowCount,
        updatedBy: user.id,
        updatedByName: user.displayName,
      });
      taken.set(tableId, hashOf(seed));
    } else {
      await deleteSeed(targetId, tableId);
      taken.set(tableId, null);
    }
    applied++;
  }
  if (applied > 0) notifyProject(targetId, { type: "seeds-changed" });
  return { applied, taken };
}
