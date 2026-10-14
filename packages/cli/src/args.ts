import { parseArgs } from "node:util";

/** The command line is wrong: an unknown command or flag, a missing argument, a value out of range. Exit code 2. */
export class UsageError extends Error {}

export interface OptionSpec {
  type: "string" | "boolean";
  short?: string;
  /** Shown in `--help` as `--name <valueName>`. */
  valueName?: string;
  description: string;
  /** The values a string option accepts. */
  choices?: readonly string[];
  required?: boolean;
}

export type CommandId =
  | "projects.list"
  | "project.export"
  | "project.import"
  | "lint"
  | "drift.check"
  | "deploy.plan"
  | "deploy.run"
  | "history.export"
  | "reviews.list";

export interface CommandSpec {
  id: CommandId;
  /** The words that select the command: `["deploy", "run"]`. */
  words: string[];
  positionals: string[];
  options: Record<string, OptionSpec>;
  summary: string;
}

export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  url: { type: "string", valueName: "url", description: "The instance's address (default: $NEBULADB_URL)" },
  insecure: { type: "boolean", description: "Allow a plain http:// address to a host other than localhost" },
  json: { type: "boolean", description: "Print the result as JSON instead of text" },
  "json-file": {
    type: "string",
    valueName: "file",
    description: "Also write the JSON result to a file, whatever the output mode",
  },
  help: { type: "boolean", short: "h", description: "Show help" },
  version: { type: "boolean", short: "v", description: "Show the version" },
};

export const COMMANDS: CommandSpec[] = [
  {
    id: "projects.list",
    words: ["projects", "list"],
    positionals: [],
    options: {},
    summary: "List the projects the key can see",
  },
  {
    id: "project.export",
    words: ["project", "export"],
    positionals: ["id"],
    options: {
      format: {
        type: "string",
        valueName: "dbml|bundle",
        choices: ["dbml", "bundle"],
        description: "dbml (default) or bundle: schema, layout, locks, seeds and generator settings",
      },
      output: { type: "string", short: "o", valueName: "file", description: "Write to a file instead of stdout" },
    },
    summary: "Export a project as DBML or as a bundle",
  },
  {
    id: "project.import",
    words: ["project", "import"],
    positionals: ["id", "file"],
    options: {
      format: {
        type: "string",
        valueName: "dbml|bundle",
        choices: ["dbml", "bundle"],
        description: "What the file holds (default: a JSON file is a bundle, anything else DBML)",
      },
      dialect: {
        type: "string",
        valueName: "postgres|mysql|mssql",
        choices: ["postgres", "mysql", "mssql"],
        description: "The file is SQL DDL of that dialect, not DBML",
      },
    },
    summary: "Import a DBML (or SQL) file or a bundle into a project",
  },
  {
    id: "lint",
    words: ["lint"],
    positionals: ["projectId"],
    options: {
      "fail-on": {
        type: "string",
        valueName: "error|warning",
        choices: ["error", "warning"],
        description: "The lowest severity that fails the run (default: error)",
      },
    },
    summary: "Lint the schema with the project's rules; fails on errors",
  },
  {
    id: "drift.check",
    words: ["drift", "check"],
    positionals: ["projectId"],
    options: {
      "ignore-unreachable": {
        type: "boolean",
        description: "Do not fail when a database could not be read",
      },
    },
    summary: "Read the project's databases now; fails when they changed outside the schema",
  },
  {
    id: "deploy.plan",
    words: ["deploy", "plan"],
    positionals: ["projectId", "connectionId"],
    options: {},
    summary: "Show what a deployment would do, without running it",
  },
  {
    id: "deploy.run",
    words: ["deploy", "run"],
    positionals: ["projectId", "connectionId"],
    options: {
      "confirm-name": {
        type: "string",
        valueName: "name",
        description: "The connection's name, required by the production stage",
      },
      resolutions: {
        type: "string",
        valueName: "file.json",
        description: "A JSON file answering the plan's risks, one entry per risk",
      },
      "no-backup": { type: "boolean", description: "Do not back the database up first (the server may refuse)" },
    },
    summary: "Deploy the schema to a database",
  },
  {
    id: "history.export",
    words: ["history", "export"],
    positionals: ["projectId", "connectionId"],
    options: {
      format: {
        type: "string",
        valueName: "sql|flyway|liquibase",
        choices: ["sql", "flyway", "liquibase"],
        description: "The migration layout (default: sql)",
      },
      output: {
        type: "string",
        short: "o",
        valueName: "file.zip",
        required: true,
        description: "Where to write the zip",
      },
    },
    summary: "Export a database's deployment history as migration files",
  },
  {
    id: "reviews.list",
    words: ["reviews", "list"],
    positionals: ["projectId"],
    options: {},
    summary: "List the project's deployment reviews",
  },
];

export type OptionValues = Record<string, string | boolean | undefined>;

export type ParsedCommandLine =
  | { kind: "help"; command: CommandSpec | null }
  | { kind: "version" }
  | { kind: "run"; command: CommandSpec; positionals: string[]; values: OptionValues };

/** `parseArgs` explains its errors at length; the first sentence says what is wrong. */
function parseArgsMessage(err: unknown): string {
  return err instanceof Error ? err.message.split(". ")[0] : String(err);
}

/** The command the leading words select, and the arguments left after them. */
function selectCommand(argv: string[]): { command: CommandSpec; rest: string[] } | null {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  for (const command of COMMANDS) {
    if (command.words.every((word, index) => words[index] === word)) {
      return { command, rest: argv.slice(command.words.length) };
    }
  }
  return null;
}

function toParseArgsOptions(options: Record<string, OptionSpec>) {
  return Object.fromEntries(
    Object.entries(options).map(([name, spec]) => [
      name,
      { type: spec.type, ...(spec.short && { short: spec.short }) },
    ]),
  );
}

/**
 * Reads a command line. Never reads the environment and never fails on a missing instance
 * address: that is `resolveConfig`'s job, so `--help` works anywhere.
 */
export function parseCommandLine(argv: string[]): ParsedCommandLine {
  if (argv.some((token) => token === "--api-key" || token.startsWith("--api-key="))) {
    throw new UsageError(
      "there is no --api-key option: put the key in $NEBULADB_API_KEY, where a process list cannot show it",
    );
  }

  const selected = selectCommand(argv);
  if (!selected) {
    // No command: only the global flags make sense (`--help`, `--version`).
    const globals = parseGlobals(argv);
    if (globals.version) return { kind: "version" };
    if (globals.help || argv.length === 0) return { kind: "help", command: null };
    const first = argv.find((token) => !token.startsWith("-"));
    throw new UsageError(
      first ? `unknown command "${argv.filter((t) => !t.startsWith("-")).join(" ")}"` : "no command given",
    );
  }

  const { command, rest } = selected;
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: toParseArgsOptions({ ...GLOBAL_OPTIONS, ...command.options }),
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(parseArgsMessage(err));
  }
  const values = parsed.values as OptionValues;
  if (values.version) return { kind: "version" };
  if (values.help) return { kind: "help", command };

  const positionals = parsed.positionals;
  for (const positional of positionals) {
    if (/^ndb_/.test(positional)) {
      throw new UsageError("an API key is never taken from the arguments: put it in $NEBULADB_API_KEY");
    }
  }
  if (positionals.length < command.positionals.length) {
    throw new UsageError(`missing <${command.positionals[positionals.length]}>`);
  }
  if (positionals.length > command.positionals.length) {
    throw new UsageError(`unexpected argument "${positionals[command.positionals.length]}"`);
  }

  for (const [name, spec] of Object.entries(command.options)) {
    const value = values[name];
    if (spec.required && value === undefined) throw new UsageError(`--${name} is required`);
    if (spec.choices && typeof value === "string" && !spec.choices.includes(value)) {
      throw new UsageError(`--${name} must be one of ${spec.choices.join(", ")}`);
    }
  }

  return { kind: "run", command, positionals, values };
}

function parseGlobals(argv: string[]): OptionValues {
  try {
    return parseArgs({
      args: argv,
      options: toParseArgsOptions(GLOBAL_OPTIONS),
      allowPositionals: true,
      strict: true,
    }).values as OptionValues;
  } catch (err) {
    throw new UsageError(parseArgsMessage(err));
  }
}

function optionLine(name: string, spec: OptionSpec): string {
  const flag = `${spec.short ? `-${spec.short}, ` : ""}--${name}${spec.type === "string" ? ` <${spec.valueName ?? "value"}>` : ""}`;
  return `  ${flag.padEnd(34)}${spec.description}`;
}

export function helpText(command: CommandSpec | null): string {
  if (command) {
    const positionals = command.positionals.map((name) => `<${name}>`).join(" ");
    const lines = [
      `nebuladb ${command.words.join(" ")}${positionals ? ` ${positionals}` : ""} [options]`,
      "",
      command.summary,
    ];
    if (Object.keys(command.options).length > 0) {
      lines.push("", "Options:", ...Object.entries(command.options).map(([name, spec]) => optionLine(name, spec)));
    }
    lines.push("", "Global options:", ...Object.entries(GLOBAL_OPTIONS).map(([name, spec]) => optionLine(name, spec)));
    return lines.join("\n");
  }

  const names = COMMANDS.map((command) => {
    const positionals = command.positionals.map((name) => `<${name}>`).join(" ");
    return [`${command.words.join(" ")}${positionals ? ` ${positionals}` : ""}`, command.summary] as const;
  });
  const width = Math.max(...names.map(([usage]) => usage.length)) + 2;
  return [
    "nebuladb <command> [options]",
    "",
    "Drives a NebulaDB instance through its public API (/api/v1).",
    "",
    "Commands:",
    ...names.map(([usage, summary]) => `  ${usage.padEnd(width)}${summary}`),
    "",
    "Global options:",
    ...Object.entries(GLOBAL_OPTIONS).map(([name, spec]) => optionLine(name, spec)),
    "",
    "Environment:",
    "  NEBULADB_URL       The instance's address",
    "  NEBULADB_API_KEY   The API key (never taken from the arguments)",
    "",
    "Exit codes:",
    "  0  done",
    "  1  the server refused, or a check found something (lint errors, drift)",
    "  2  usage error",
    "  3  network or authentication error",
    "",
    "Run `nebuladb <command> --help` for a command's options.",
  ].join("\n");
}
