import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { StringDecoder } from "node:string_decoder";
import {
  CsvStreamParser,
  SeedValidator,
  detectSeparator,
  parseCsv,
  suggestMapping,
  type SeedIssue,
  type SeedOptions,
  type SeedSeparator,
  type Table,
  type TableSeed,
} from "@nebuladb/shared";
import { config } from "../../config.js";
import { ApiError } from "../../shared/errors.js";
import type { SeedFileCheck } from "./repository.js";

/**
 * Seeds kept as files. A seed too big for the database is one CSV per table under `config.seedDir`
 * (`<project>/<table>.csv`); the database only keeps what it is called, how big it is and what its check found.
 * The file is never read as one string: every reader here goes through a stream.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;

/** The name a table's seed file has under the seed directory. Ids come from the client: nothing else than a plain id may become a path. */
export function seedFileName(projectId: string, tableId: string): string {
  if (!SAFE_SEGMENT.test(projectId) || !SAFE_SEGMENT.test(tableId)) throw new ApiError("SEED_INVALID");
  return `${projectId}/${tableId}.csv`;
}

/** The absolute path of a seed file, which must stay inside the seed directory. */
export function seedFilePath(fileName: string): string {
  const root = path.resolve(config.seedDir);
  const target = path.resolve(root, fileName);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ApiError("SEED_INVALID");
  return target;
}

export async function removeSeedFile(fileName: string | null | undefined): Promise<void> {
  if (!fileName) return;
  await fsp.rm(seedFilePath(fileName), { force: true }).catch(() => {});
}

/** Every row of a seed, header included, in file order — from memory for a small seed, from the file as a stream for a big one. */
export async function* seedRowStream(
  seed: Pick<TableSeed, "storage" | "content" | "options"> & { fileName?: string | null },
): AsyncGenerator<(string | null)[]> {
  if (seed.storage !== "file") {
    for (const row of parseCsv(seed.content, seed.options.separator)) yield row;
    return;
  }
  if (!seed.fileName) throw new ApiError("SEED_NOT_FOUND");
  const parser = new CsvStreamParser(seed.options.separator);
  const decoder = new StringDecoder("utf8");
  for await (const chunk of fs.createReadStream(seedFilePath(seed.fileName), { highWaterMark: 1 << 20 })) {
    for (const row of parser.push(decoder.write(chunk as Buffer))) yield row;
  }
  for (const row of parser.push(decoder.end())) yield row;
  for (const row of parser.end()) yield row;
}

/** The first `count` rows (header included) of a seed. */
export async function seedPreview(
  seed: Pick<TableSeed, "storage" | "content" | "options"> & { fileName?: string | null },
  count: number,
): Promise<(string | null)[][]> {
  const rows: (string | null)[][] = [];
  for await (const row of seedRowStream(seed)) {
    rows.push(row);
    if (rows.length >= count) break;
  }
  return rows;
}

export interface IngestInput {
  projectId: string;
  table: Table;
  source: AsyncIterable<Buffer | string>;
  /**
   * `null`: derived from the file — the separator the first line uses, the first row as a header, the columns
   * matched to the table's by name. What an administrator importing files by path gets, with no dialog to ask.
   */
  options: SeedOptions | null;
  maxBytes: number;
}

export interface IngestResult {
  fileName: string;
  bytes: number;
  rowCount: number;
  options: SeedOptions;
  check: SeedFileCheck;
  /** The first issues the file's own check found (at most `SEED_MAX_ISSUES`), and how many there are in all. */
  issues: SeedIssue[];
  total: number;
}

/**
 * Writes a seed file from a stream of bytes and checks it on the way, row by row, without ever holding it:
 * parsed as it arrives, each row validated against the table and let go. The file replaces the table's
 * previous one only once it is complete and its first row fits the mapping; any failure leaves no part file.
 */
export async function ingestSeedStream(input: IngestInput): Promise<IngestResult> {
  const { projectId, table, source, maxBytes } = input;
  const fileName = seedFileName(projectId, table.id);
  const target = seedFilePath(fileName);
  const part = `${target}.part-${randomUUID()}`;
  await fsp.mkdir(path.dirname(target), { recursive: true });

  const out = fs.createWriteStream(part);
  let writeError: Error | null = null;
  out.on("error", (err) => {
    writeError = err;
  });

  const decoder = new StringDecoder("utf8");
  let parser: CsvStreamParser | null = null;
  let separator: SeedSeparator | null = input.options?.separator ?? null;
  let options: SeedOptions | null = input.options;
  let validator: SeedValidator | null = null;
  let bytes = 0;

  const feed = (rows: (string | null)[][]) => {
    for (const cells of rows) {
      if (!validator) {
        if (!options) {
          options = { separator: separator!, header: true, mapping: suggestMapping(cells, table.fields), mode: "if-empty" };
        } else if (options.mapping.length !== cells.length) {
          throw new ApiError("SEED_INVALID", { message: "the mapping needs one entry per CSV column" });
        }
        validator = new SeedValidator(table, options, {}, { maxKeys: config.seedMaxKeys });
      }
      validator.add(cells);
    }
  };

  try {
    for await (const raw of source) {
      const chunk = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        throw new ApiError("SEED_INVALID", { message: `the file is over the ${maxBytes} bytes a seed may take` });
      }
      if (writeError) throw writeError;
      if (!out.write(chunk)) await once(out, "drain");
      const text = decoder.write(chunk);
      if (!parser) {
        separator ??= detectSeparator(text);
        parser = new CsvStreamParser(separator);
      }
      feed(parser.push(text));
    }
    if (!parser) throw new ApiError("SEED_INVALID", { message: "the file is empty" });
    feed(parser.push(decoder.end()));
    feed(parser.end());
    const finished = validator as SeedValidator | null;
    if (!finished || !options) throw new ApiError("SEED_INVALID", { message: "the file is empty" });

    out.end();
    await once(out, "finish");
    if (writeError) throw writeError;
    await fsp.rename(part, target);

    const result = finished.finish();
    return {
      fileName,
      bytes,
      rowCount: result.rows,
      options,
      check: {
        overflows: result.overflows,
        unchecked: result.unchecked,
        errors: result.total - result.warnings,
        warnings: result.warnings,
      },
      issues: result.issues,
      total: result.total,
    };
  } catch (err) {
    out.destroy();
    await fsp.rm(part, { force: true }).catch(() => {});
    throw err;
  }
}
