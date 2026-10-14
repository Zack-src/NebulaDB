import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { helpText, parseCommandLine, UsageError } from "./args.js";
import { ApiClient, ApiError, NetworkError, type FetchLike } from "./client.js";
import { HANDLERS } from "./commands.js";
import { resolveConfig } from "./config.js";
import { formatApiError } from "./format.js";

export const EXIT_OK = 0;
/** The server refused, or a check (lint, drift, a plan) found something. */
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
/** The server could not be reached, or the key was not accepted. */
export const EXIT_NETWORK = 3;

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  fetch?: FetchLike;
}

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

/** Runs one command line and returns the exit code. Never throws, never exits: `bin.ts` does that. */
export async function run(argv: string[], io: Io): Promise<number> {
  const apiKey = io.env.NEBULADB_API_KEY?.trim();
  // The key is read from the environment only and never echoed; this is the belt to that pair of braces.
  const scrub = (text: string) => (apiKey ? text.split(apiKey).join("[redacted]") : text);
  const out = (text: string) => io.stdout(scrub(text));
  const err = (text: string) => io.stderr(scrub(text));
  const wantsJson = argv.includes("--json");
  let jsonFile: string | undefined;

  /** Reports a failure: text on stderr, or the server's own `{ error, code, ... }` shape on stdout with `--json`. */
  const fail = async (code: number, message: string, payload: Record<string, unknown>) => {
    if (wantsJson) out(`${JSON.stringify(payload)}\n`);
    else err(`nebuladb: ${message}\n`);
    await writeJsonFile(jsonFile, payload, out);
    return code;
  };

  try {
    const parsed = parseCommandLine(argv);
    if (parsed.kind === "help") {
      out(`${helpText(parsed.command)}\n`);
      return EXIT_OK;
    }
    if (parsed.kind === "version") {
      out(`${version()}\n`);
      return EXIT_OK;
    }

    jsonFile = typeof parsed.values["json-file"] === "string" ? parsed.values["json-file"] : undefined;
    const config = resolveConfig(parsed.values, io.env);
    const client = new ApiClient(config, io.fetch);
    const outcome = await HANDLERS[parsed.command.id]({
      client,
      positionals: parsed.positionals,
      values: parsed.values,
    });

    if (parsed.values.json === true) out(`${JSON.stringify(outcome.data, null, 2)}\n`);
    else out(outcome.raw ? outcome.text : `${outcome.text}\n`);
    await writeJsonFile(jsonFile, outcome.data, out);
    return outcome.failed ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      return fail(EXIT_USAGE, `${error.message}\nRun \`nebuladb --help\` for usage.`, {
        error: error.message,
        code: "USAGE",
      });
    }
    if (error instanceof ApiError) {
      return fail(error.isAuth ? EXIT_NETWORK : EXIT_FAILED, formatApiError(error), {
        error: error.message,
        code: error.code,
        status: error.status,
        ...error.details,
      });
    }
    if (error instanceof NetworkError) {
      return fail(EXIT_NETWORK, error.message, { error: error.message, code: "NETWORK" });
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(EXIT_FAILED, message, { error: message, code: "INTERNAL" });
  }
}

async function writeJsonFile(path: string | undefined, data: unknown, out: (text: string) => void): Promise<void> {
  if (!path) return;
  try {
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  } catch (err) {
    out(`nebuladb: cannot write ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
