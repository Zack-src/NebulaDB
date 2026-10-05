import { DEFAULT_LINT_SETTINGS, type LintSettings } from "@athanordb/dbml-engine";
import {
  chooseLintPreset,
  fetchLintState,
  saveLintSettings,
  type LintPresetChoice,
  type LintSource,
  type LintState as ServerLintState,
} from "@/services/lintApi";

const BUILTIN: LintSource = { kind: "builtin" };

/**
 * The project's lint settings as the server last gave them — what the editor
 * lints with — and where they come from (its own version, a preset, the
 * instance default). Refetched when the project changes and when the server
 * announces `lint-changed`; the defaults until then, so the canvas never
 * waits on them.
 */
export class LintState {
  settings = $state.raw<LintSettings>(DEFAULT_LINT_SETTINGS);
  source = $state.raw<LintSource>(BUILTIN);
  /** The presets a project administrator may pick from; empty for everyone else. */
  presets = $state.raw<LintPresetChoice[]>([]);
  private requested = 0;

  constructor(private readonly projectId: () => string) {
    $effect(() => {
      this.projectId();
      this.settings = DEFAULT_LINT_SETTINGS;
      this.source = BUILTIN;
      this.presets = [];
      void this.refresh();
    });
  }

  private apply(state: ServerLintState) {
    this.settings = state.settings;
    this.source = state.source;
    this.presets = state.presets;
  }

  refresh = async (): Promise<void> => {
    const ticket = ++this.requested;
    try {
      const state = await fetchLintState(this.projectId());
      if (ticket === this.requested) this.apply(state);
    } catch {
      // Offline, or the perf harness: the default rules are better than a broken editor.
    }
  };

  /** Saves the project's own version of the rules. Throws what the server answered — the caller shows it. */
  save = async (settings: LintSettings): Promise<void> => {
    const ticket = ++this.requested;
    const state = await saveLintSettings(this.projectId(), settings);
    if (ticket === this.requested) this.apply(state);
  };

  /** Follows a preset (or the instance default with `null`); the project's own version is dropped. */
  choosePreset = async (presetId: string | null): Promise<void> => {
    const ticket = ++this.requested;
    const state = await chooseLintPreset(this.projectId(), presetId);
    if (ticket === this.requested) this.apply(state);
  };
}
