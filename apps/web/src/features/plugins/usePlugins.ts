import { useEffect, useMemo, useSyncExternalStore } from "react";
import { pluginRegistry } from "@/features/plugins/registry";
import type {
  CanvasCommandContribution,
  EditorCommandContribution,
  ExporterContribution,
  ImporterContribution,
  PluginRecord,
  ResolvedContribution,
} from "@/features/plugins/types";

const subscribe = (listener: () => void) => pluginRegistry.subscribe(listener);
const getSnapshot = () => pluginRegistry.getSnapshot();

/** Every plugin the user has, built-in or installed, re-rendering on any change. */
export function usePlugins(): PluginRecord[] {
  const records = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => pluginRegistry.init(), []);
  return records;
}

/**
 * `records` is in the dependency list on purpose even though `resolve()` reads
 * the registry directly: it is the value that changes when a plugin is
 * installed, toggled or removed, and that is exactly when these lists must be
 * recomputed.
 */
function useResolved<T extends ResolvedContribution>(
  kind: "exporter" | "importer" | "canvasCommand" | "editorCommand",
  projectId: string,
): T[] {
  const records = usePlugins();
  return useMemo(() => {
    void records;
    return pluginRegistry.resolve(kind as "exporter", { projectId }) as unknown as T[];
  }, [records, kind, projectId]);
}

export function useExporters(projectId: string): ResolvedContribution<ExporterContribution>[] {
  return useResolved<ResolvedContribution<ExporterContribution>>("exporter", projectId);
}

export function useImporters(projectId: string): ResolvedContribution<ImporterContribution>[] {
  return useResolved<ResolvedContribution<ImporterContribution>>("importer", projectId);
}

export function useCanvasCommands(projectId: string): ResolvedContribution<CanvasCommandContribution>[] {
  return useResolved<ResolvedContribution<CanvasCommandContribution>>("canvasCommand", projectId);
}

export function useEditorCommands(projectId: string): ResolvedContribution<EditorCommandContribution>[] {
  return useResolved<ResolvedContribution<EditorCommandContribution>>("editorCommand", projectId);
}
