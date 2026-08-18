import type {
  Contribution,
  ContributionKind,
  InvokeInput,
  InvokeResult,
  PluginManifest,
  PluginSettings,
} from "@/features/plugins/types";

export interface PluginRunContext {
  projectId: string;
  settings?: PluginSettings;
  /** Ids of the tables currently selected on the canvas — `registry.ts`'s `invoke` always stamps this on before calling a builtin, even though a caller that ignores selection never has to pass one in. */
  selection?: { tableIds: string[] };
  /**
   * Snapshots the live rendered React Flow canvas — only ever supplied by
   * `ExportDialog` (see `useExporters`'s optional second argument), and only
   * ever reaches a *builtin* runner: `PluginHost.invoke`'s message to a
   * sandboxed user plugin worker deliberately forwards just
   * `settings`/`selection`, so a function reference here can never leak
   * across that boundary even by accident.
   */
  captureCanvasImage?: (format: "png" | "svg") => Promise<{ dataUrl: string; width: number; height: number }>;
}

export type BuiltinRunner = (input: unknown, ctx: PluginRunContext) => Promise<unknown> | unknown;

export interface BuiltinPlugin {
  manifest: PluginManifest;
  contributions: Contribution[];
  run: (
    kind: ContributionKind,
    id: string,
    input: InvokeInput,
    ctx: PluginRunContext,
  ) => Promise<InvokeResult> | InvokeResult;
}
