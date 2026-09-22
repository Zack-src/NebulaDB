import { pluginRegistry } from "@/features/plugins/registry";
import type { PluginRunContext } from "@/features/plugins/builtins";
import type {
  CanvasCommandContribution,
  EditorCommandContribution,
  ExporterContribution,
  ImporterContribution,
  PluginRecord,
  ResolvedContribution,
} from "@/features/plugins/types";

/**
 * The registry's record list as reactive state — one subscription for the
 * whole app, updated whenever a plugin is installed, toggled or removed. The
 * registry hands out a stable array between changes, so readers only update
 * when something they can see actually changed.
 */
class PluginRecords {
  records = $state.raw<PluginRecord[]>(pluginRegistry.getSnapshot());
}

const shared = new PluginRecords();
pluginRegistry.subscribe(() => {
  shared.records = pluginRegistry.getSnapshot();
});

/** Every plugin the user has, built-in or installed. Boots the stored user plugins on first use. */
export function usePlugins(): { readonly records: PluginRecord[] } {
  pluginRegistry.init();
  return shared;
}

type ContributionKind = "exporter" | "importer" | "canvasCommand" | "editorCommand";

/**
 * `records` is read on purpose even though `resolve()` reads the registry
 * directly: it is the value that changes when a plugin is installed, toggled
 * or removed, and that is exactly when these lists must be recomputed.
 */
function useResolved<T extends ResolvedContribution>(
  kind: ContributionKind,
  projectId: () => string,
  extraCtx?: Omit<PluginRunContext, "projectId">,
): { readonly list: T[] } {
  const plugins = usePlugins();
  const list = $derived.by(() => {
    void plugins.records;
    return pluginRegistry.resolve(kind as "exporter", { projectId: projectId(), ...extraCtx }) as unknown as T[];
  });
  return {
    get list() {
      return list;
    },
  };
}

export function useExporters(
  projectId: () => string,
  extraCtx?: Omit<PluginRunContext, "projectId">,
): { readonly list: ResolvedContribution<ExporterContribution>[] } {
  return useResolved<ResolvedContribution<ExporterContribution>>("exporter", projectId, extraCtx);
}

export function useImporters(projectId: () => string): { readonly list: ResolvedContribution<ImporterContribution>[] } {
  return useResolved<ResolvedContribution<ImporterContribution>>("importer", projectId);
}

export function useCanvasCommands(
  projectId: () => string,
): { readonly list: ResolvedContribution<CanvasCommandContribution>[] } {
  return useResolved<ResolvedContribution<CanvasCommandContribution>>("canvasCommand", projectId);
}

export function useEditorCommands(
  projectId: () => string,
): { readonly list: ResolvedContribution<EditorCommandContribution>[] } {
  return useResolved<ResolvedContribution<EditorCommandContribution>>("editorCommand", projectId);
}
