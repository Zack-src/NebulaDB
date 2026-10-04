import { DEFAULT_LINT_SETTINGS, type LintSettings } from "@athanordb/dbml-engine";
import { fetchLintSettings, saveLintSettings } from "@/services/lintApi";

/**
 * The project's lint settings as the server last gave them — what the editor
 * lints with. Refetched when the project changes and when the server
 * announces `lint-changed`; the defaults until then, so the canvas never
 * waits on them.
 */
export class LintState {
  settings = $state.raw<LintSettings>(DEFAULT_LINT_SETTINGS);
  private requested = 0;

  constructor(private readonly projectId: () => string) {
    $effect(() => {
      this.projectId();
      this.settings = DEFAULT_LINT_SETTINGS;
      void this.refresh();
    });
  }

  refresh = async (): Promise<void> => {
    const ticket = ++this.requested;
    try {
      const settings = await fetchLintSettings(this.projectId());
      if (ticket === this.requested) this.settings = settings;
    } catch {
      // Offline, or the perf harness: the default rules are better than a broken editor.
    }
  };

  /** Throws what the server answered — the caller shows it. */
  save = async (settings: LintSettings): Promise<void> => {
    const ticket = ++this.requested;
    const saved = await saveLintSettings(this.projectId(), settings);
    if (ticket === this.requested) this.settings = saved;
  };
}
