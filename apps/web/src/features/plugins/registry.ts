import { PluginHost } from "@/features/plugins/PluginHost";
import { readJson, writeJson } from "@/utils/storage";
import { normalizeShortcut } from "@/features/plugins/shortcuts";
import { BUILTIN_PLUGINS, type BuiltinPlugin, type PluginRunContext } from "@/features/plugins/builtins";
import type {
  CanvasCommandContribution,
  Contribution,
  ContributionKind,
  EditorCommandContribution,
  ExporterContribution,
  ImporterContribution,
  InvokeInput,
  InvokeResult,
  PluginManifest,
  PluginRecord,
  PluginSettingValue,
  PluginSettings,
  ResolvedContribution,
} from "@/features/plugins/types";

const STORAGE_KEY = "athanordb_plugins";
const SETTINGS_KEY = "athanordb_plugin_settings";
const MAX_PLUGIN_CODE_LENGTH = 512 * 1024;

interface StoredPlugin {
  /** Manifest id once the plugin has loaded successfully; a temporary id before that. */
  id: string;
  code: string;
  enabled: boolean;
}

function readStored(): StoredPlugin[] {
  const parsed = readJson<unknown>(STORAGE_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((p): p is StoredPlugin => Boolean(p) && typeof p.id === "string" && typeof p.code === "string");
}

function writeStored(plugins: StoredPlugin[]): void {
  writeJson(STORAGE_KEY, plugins);
}

function readAllSettings(): Record<string, PluginSettings> {
  const parsed = readJson<unknown>(SETTINGS_KEY);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, PluginSettings>) : {};
}

function defaultFor(type: "string" | "number" | "boolean" | "select"): PluginSettingValue {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

/**
 * The one place that knows which plugins exist, built-in or installed.
 *
 * Plugins are per-user and live in `localStorage` — nothing is uploaded, and
 * the server has no idea they exist. That is deliberate for a first cut: it
 * keeps arbitrary third-party code out of a shared, multi-user server, and
 * makes installing one a decision only the person running it is exposed to.
 */
class PluginRegistry {
  private readonly records = new Map<string, PluginRecord>();
  private readonly hosts = new Map<string, PluginHost>();
  private readonly listeners = new Set<() => void>();
  private readonly builtins = new Map<string, BuiltinPlugin>();
  private snapshot: PluginRecord[] = [];
  private initialized = false;

  constructor() {
    for (const builtin of BUILTIN_PLUGINS) {
      this.builtins.set(builtin.manifest.id, builtin);
      this.records.set(builtin.manifest.id, {
        manifest: builtin.manifest,
        source: "builtin",
        enabled: true,
        contributions: builtin.contributions,
      });
    }
    this.refreshSnapshot();
  }

  /** Boots every stored user plugin. Safe to call repeatedly; only the first call does work. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const stored of readStored()) void this.boot(stored);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stable array identity between changes, so `useSyncExternalStore` doesn't loop. */
  getSnapshot(): PluginRecord[] {
    return this.snapshot;
  }

  logsFor(pluginId: string): string[] {
    return this.hosts.get(pluginId)?.logs ?? [];
  }

  /** Declared defaults merged with whatever the user has saved. */
  settingsFor(pluginId: string): PluginSettings {
    const record = this.records.get(pluginId);
    const saved = readAllSettings()[pluginId] ?? {};
    const settings: PluginSettings = {};
    for (const def of record?.manifest.settings ?? []) {
      const value = saved[def.key];
      settings[def.key] =
        value !== undefined ? value : ((def.default as PluginSettingValue | undefined) ?? defaultFor(def.type));
    }
    return settings;
  }

  getSettings(pluginId: string): PluginSettings {
    return this.settingsFor(pluginId);
  }

  setSettings(pluginId: string, settings: PluginSettings): void {
    const all = readAllSettings();
    all[pluginId] = { ...(all[pluginId] ?? {}), ...settings };
    writeJson(SETTINGS_KEY, all);
    this.refreshSnapshot();
  }

  setSetting(pluginId: string, key: string, value: PluginSettingValue): void {
    const all = readAllSettings();
    all[pluginId] = { ...(all[pluginId] ?? {}), [key]: value };
    writeJson(SETTINGS_KEY, all);
    this.refreshSnapshot();
  }

  /**
   * Shortcut -> contribution, for the app's global key handler. First
   * registration wins so a newly installed plugin can never silently steal a
   * binding another plugin already had.
   */
  shortcuts(kind: ContributionKind): Map<string, Contribution & { pluginId: string }> {
    const map = new Map<string, Contribution & { pluginId: string }>();
    for (const record of this.snapshot) {
      if (!record.enabled) continue;
      for (const contribution of record.contributions) {
        if (contribution.kind !== kind || !contribution.shortcut) continue;
        const key = normalizeShortcut(contribution.shortcut);
        if (!key || map.has(key)) continue;
        map.set(key, { ...contribution, pluginId: record.manifest.id });
      }
    }
    return map;
  }

  /**
   * Dry-run boots a plugin in a temporary sandbox Worker to validate its syntax,
   * manifest and registered contributions without installing or persisting it.
   */
  async validate(code: string): Promise<{ manifest: PluginManifest; contributions: Contribution[] }> {
    const trimmed = code.trim();
    if (!trimmed) throw new Error("Le code source du plugin est vide");
    if (trimmed.length > MAX_PLUGIN_CODE_LENGTH) {
      throw new Error(`Le code est trop volumineux (max ${Math.round(MAX_PLUGIN_CODE_LENGTH / 1024)}kB)`);
    }
    const host = new PluginHost(trimmed);
    try {
      const load = await host.load();
      return load;
    } finally {
      host.dispose();
    }
  }

  getAllLogs(): Array<{ pluginId: string; pluginName: string; line: string }> {
    const all: Array<{ pluginId: string; pluginName: string; line: string }> = [];
    for (const [pluginId, host] of this.hosts.entries()) {
      const record = this.records.get(pluginId);
      const pluginName = record?.manifest.name ?? pluginId;
      for (const line of host.logs) {
        all.push({ pluginId, pluginName, line });
      }
    }
    return all;
  }

  /**
   * Installs plugin source: boots it in a sandbox, waits for its manifest, and
   * only persists it once it has actually registered something. A plugin that
   * throws on load is reported to the caller and not stored.
   */
  async install(code: string): Promise<PluginRecord> {
    const trimmed = code.trim();
    if (!trimmed) throw new Error("plugin source is empty");
    if (trimmed.length > MAX_PLUGIN_CODE_LENGTH) {
      throw new Error(`plugin source is too large (max ${Math.round(MAX_PLUGIN_CODE_LENGTH / 1024)}kB)`);
    }

    const host = new PluginHost(trimmed, () => this.emit());
    let load;
    try {
      load = await host.load();
    } catch (err) {
      host.dispose();
      throw err instanceof Error ? err : new Error(String(err));
    }

    const id = load.manifest.id;
    if (this.builtins.has(id)) {
      host.dispose();
      throw new Error(`"${id}" is the id of a built-in plugin — pick another one`);
    }
    // Reinstalling the same id replaces it rather than erroring: that is the
    // normal edit-and-reload loop while writing a plugin.
    this.hosts.get(id)?.dispose();
    this.hosts.set(id, host);

    const record: PluginRecord = {
      manifest: load.manifest,
      source: "user",
      enabled: true,
      contributions: load.contributions,
      code: trimmed,
    };
    this.records.set(id, record);
    writeStored([...readStored().filter((p) => p.id !== id), { id, code: trimmed, enabled: true }]);
    this.refreshSnapshot();
    return record;
  }

  uninstall(pluginId: string): void {
    const record = this.records.get(pluginId);
    if (!record || record.source === "builtin") return;
    this.hosts.get(pluginId)?.dispose();
    this.hosts.delete(pluginId);
    this.records.delete(pluginId);
    writeStored(readStored().filter((p) => p.id !== pluginId));
    this.refreshSnapshot();
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const record = this.records.get(pluginId);
    if (!record) return;
    this.records.set(pluginId, { ...record, enabled });
    if (record.source === "user") {
      writeStored(readStored().map((p) => (p.id === pluginId ? { ...p, enabled } : p)));
      // A disabled plugin shouldn't keep a worker alive; it gets a fresh one
      // when re-enabled.
      if (!enabled) {
        this.hosts.get(pluginId)?.dispose();
        this.hosts.delete(pluginId);
      } else if (record.code && !this.hosts.has(pluginId)) {
        this.hosts.set(pluginId, new PluginHost(record.code, () => this.emit()));
      }
    }
    this.refreshSnapshot();
  }

  /** Every enabled contribution of one kind, each bound to the project it will run against. */
  resolve(kind: "exporter", ctx: PluginRunContext): ResolvedContribution<ExporterContribution>[];
  resolve(kind: "importer", ctx: PluginRunContext): ResolvedContribution<ImporterContribution>[];
  resolve(kind: "canvasCommand", ctx: PluginRunContext): ResolvedContribution<CanvasCommandContribution>[];
  resolve(kind: "editorCommand", ctx: PluginRunContext): ResolvedContribution<EditorCommandContribution>[];
  resolve(kind: ContributionKind, ctx: PluginRunContext): ResolvedContribution[] {
    const resolved: ResolvedContribution[] = [];
    for (const record of this.snapshot) {
      if (!record.enabled) continue;
      for (const contribution of record.contributions) {
        if (contribution.kind !== kind) continue;
        resolved.push({
          key: `${record.manifest.id}:${contribution.id}`,
          plugin: record.manifest,
          source: record.source,
          contribution,
          run: (input: InvokeInput, options?: { selection?: string[] }) =>
            this.invoke(record.manifest.id, kind, contribution.id, input, ctx, options?.selection ?? []),
        });
      }
    }
    return resolved;
  }

  private async invoke(
    pluginId: string,
    kind: ContributionKind,
    contributionId: string,
    input: InvokeInput,
    ctx: PluginRunContext,
    selection: string[],
  ): Promise<InvokeResult> {
    const runtime = { ...ctx, settings: this.settingsFor(pluginId), selection: { tableIds: selection } };
    const builtin = this.builtins.get(pluginId);
    if (builtin) return builtin.run(kind, contributionId, input, runtime);

    const record = this.records.get(pluginId);
    let host = this.hosts.get(pluginId);
    if (!host) {
      if (!record?.code) throw new Error(`plugin ${pluginId} is not installed`);
      host = new PluginHost(record.code, () => this.emit());
      this.hosts.set(pluginId, host);
    }
    try {
      const result = await host.invoke(kind, contributionId, input, {
        settings: runtime.settings,
        selection: runtime.selection,
      });
      // Only rebuild the snapshot when something a subscriber can see actually
      // changed. Refreshing on every successful call would hand React a new
      // array (and new resolved contributions) after each invocation, which is
      // an effect -> invoke -> new identity -> effect loop for any component
      // that runs an exporter from an effect.
      if (record?.error) {
        this.records.set(pluginId, { ...record, error: undefined });
        this.refreshSnapshot();
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Same guard as the success path above, and for the same reason: an
      // unconditional refresh here handed React a fresh snapshot after every
      // *failed* call, so a plugin exporter that throws re-triggered the very
      // effect that had just invoked it — an infinite invoke loop that span up
      // a Worker per iteration and locked the tab.
      if (record && record.error !== message) {
        this.records.set(pluginId, { ...record, error: message });
        this.refreshSnapshot();
      }
      throw new Error(message, { cause: err });
    }
  }

  /** Boots a stored plugin at startup, recording (rather than throwing) a load failure. */
  private async boot(stored: StoredPlugin): Promise<void> {
    if (!stored.enabled) {
      this.records.set(stored.id, {
        manifest: { id: stored.id, name: stored.id },
        source: "user",
        enabled: false,
        contributions: [],
        code: stored.code,
      });
      this.refreshSnapshot();
      return;
    }
    const host = new PluginHost(stored.code, () => this.emit());
    try {
      const load = await host.load();
      this.hosts.set(load.manifest.id, host);
      this.records.set(load.manifest.id, {
        manifest: load.manifest,
        source: "user",
        enabled: true,
        contributions: load.contributions,
        code: stored.code,
      });
      if (load.manifest.id !== stored.id) {
        // The stored id was a placeholder (or the author changed it) — keep
        // storage keyed by whatever the manifest actually says.
        writeStored([
          ...readStored().filter((p) => p.id !== stored.id && p.id !== load.manifest.id),
          { id: load.manifest.id, code: stored.code, enabled: true },
        ]);
      }
    } catch (err) {
      host.dispose();
      this.records.set(stored.id, {
        manifest: { id: stored.id, name: stored.id },
        source: "user",
        enabled: true,
        contributions: [],
        code: stored.code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.refreshSnapshot();
  }

  private refreshSnapshot(): void {
    this.snapshot = Array.from(this.records.values()).sort((a, b) => {
      if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
      return a.manifest.name.localeCompare(b.manifest.name);
    });
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const pluginRegistry = new PluginRegistry();
export type { Contribution, PluginRecord, ResolvedContribution };
