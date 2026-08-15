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
