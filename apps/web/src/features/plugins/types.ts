import type { Project } from "@athanordb/shared";

export type PluginCategory = "export" | "import" | "canvas" | "editor" | "tools" | "community";

/**
 * What a plugin declares about itself. Authored inside the plugin source via
 * `athanor.plugin({...})`; built-in plugins provide the same shape from code.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  category?: PluginCategory;
  icon?: string;
  tags?: string[];
  homepage?: string;
  doc?: string;
  /** Settings the plugin declares; their values are edited in the manager and passed to every `run` call. */
  settings?: PluginSettingDef[];
}

/**
 * One configurable value. Deliberately a tiny closed set of types: the plugin
 * declares data, the app renders the form. A plugin never gets to draw UI.
 */
export type PluginSettingDef =
  | { key: string; label: string; type: "string"; default?: string; description?: string }
  | { key: string; label: string; type: "number"; default?: number; description?: string }
  | { key: string; label: string; type: "boolean"; default?: boolean; description?: string }
  | { key: string; label: string; type: "select"; options: string[]; default?: string; description?: string };

export type PluginSettingValue = string | number | boolean;
export type PluginSettings = Record<string, PluginSettingValue>;

export type ContributionKind = "exporter" | "importer" | "canvasCommand" | "editorCommand";

interface ContributionBase {
  /** Unique within its plugin; the registry namespaces it as `<pluginId>:<id>`. */
  id: string;
  label: string;
  description?: string;
  /**
   * Optional keyboard shortcut, e.g. `"Ctrl+Alt+S"` / `"Shift+Alt+K"`. Only
   * meaningful for commands; the registry rejects one that collides with
   * another plugin's, and the app's own bindings always win.
   */
  shortcut?: string;
}

export interface ExporterContribution extends ContributionBase {
  kind: "exporter";
  /** File extension for the download, without the dot. Defaults to `txt`. */
  extension?: string;
  /**
   * Set only by an exporter that returns `ExportResult.image` rather than
   * `.text` (the built-in canvas-snapshot ones). Declared on the
   * contribution itself, not just inferred from a run's result, so the
   * dialog knows to render the image-preview layout the instant it's
   * selected — before the (async) capture has actually resolved.
   */
  imageKind?: "png" | "svg";
}

export interface ImporterContribution extends ContributionBase {
  kind: "importer";
  /** Extensions this importer claims, used to preselect it when a file is chosen. */
  fileExtensions?: string[];
}

export interface CanvasCommandContribution extends ContributionBase {
  kind: "canvasCommand";
}

export interface EditorCommandContribution extends ContributionBase {
  kind: "editorCommand";
}

export type Contribution =
  ExporterContribution | ImporterContribution | CanvasCommandContribution | EditorCommandContribution;

/**
 * What an exporter returns: either generated document text (plus an optional
 * extension override), or — for the built-in canvas-snapshot exporters,
 * which capture the live rendered canvas rather than generating text from
 * the project data — a captured image. Exactly one of the two is set.
 */
export interface ExportResult {
  text?: string;
  extension?: string;
  image?: { dataUrl: string; width: number; height: number; format: "png" | "svg" };
}

/**
 * What an importer returns: DBML source. Importers deliberately produce DBML
 * rather than a `Project` — the existing server-side import route already
 * merges DBML into a project by name (keeping positions and detail levels), so
 * a plugin only has to handle its own input format.
 */
export interface ImportResult {
  dbml: string;
}

/**
 * What a canvas command returns: the whole project, modified. Whole-project
 * (rather than a patch list) keeps the plugin API a pure function of plain
 * JSON — the host diffs it into the Y.Doc via `writeProjectToDoc`, which only
 * writes entities that actually changed. `null` means "nothing to do".
 */
export interface CanvasCommandResult {
  project?: Project | null;
  message?: string;
}

/** What an editor command returns: the full replacement buffer, or nothing. */
export interface EditorCommandResult {
  text?: string | null;
  message?: string;
}

export interface EditorCommandInput {
  text: string;
  selection: { from: number; to: number };
  selectedText: string;
}

export type InvokeInput = Project | string | EditorCommandInput;
export type InvokeResult = ExportResult | ImportResult | CanvasCommandResult | EditorCommandResult;

/**
 * Second argument handed to every `run(input, context)`. Added after the first
 * cut, which is why it is a second parameter rather than part of the input:
 * plugins written against `run(project)` keep working untouched.
 */
export interface InvokeContext {
  settings: PluginSettings;
  /** Ids of the tables currently selected on the canvas (empty when nothing is selected). */
  selection: { tableIds: string[] };
}

/** Where a plugin came from — built-ins ship with the app and can't be uninstalled. */
export type PluginSource = "builtin" | "user";

export interface PluginRecord {
  manifest: PluginManifest;
  source: PluginSource;
  enabled: boolean;
  contributions: Contribution[];
  /** Set when the plugin failed to load or its last invocation threw. */
  error?: string;
  /** Raw source for user plugins — kept so it can be re-run and re-exported. */
  code?: string;
}

/** A contribution resolved against the plugin that owns it, ready to run. */
export interface ResolvedContribution<C extends Contribution = Contribution> {
  /** `<pluginId>:<contributionId>` — stable across reloads, safe as a React key. */
  key: string;
  plugin: PluginManifest;
  source: PluginSource;
  contribution: C;
  /**
   * `options` carries whatever is only known at call time (the canvas
   * selection). Settings are looked up by the registry, not by the caller.
   */
  run: (input: InvokeInput, options?: { selection?: string[] }) => Promise<InvokeResult>;
}

// ---------------------------------------------------------------------------
// Worker message protocol (host <-> sandboxed plugin worker)
// ---------------------------------------------------------------------------

export type HostToWorkerMessage = {
  type: "invoke";
  callId: number;
  kind: ContributionKind;
  id: string;
  input: InvokeInput;
  context: InvokeContext;
};

export type WorkerToHostMessage =
  | { type: "ready"; manifest: PluginManifest; contributions: Contribution[] }
  | { type: "load-error"; message: string }
  | { type: "result"; callId: number; value: InvokeResult }
  | { type: "error"; callId: number; message: string }
  | { type: "log"; level: "log" | "warn" | "error"; args: string[] };
