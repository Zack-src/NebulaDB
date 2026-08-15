import { coreExportPlugin } from "./coreExport";
import { coreImportPlugin } from "./coreImport";
import { coreCanvasPlugin, RESET_LINK_ROUTING_ID } from "./coreCanvas";
import { coreEditorPlugin } from "./coreEditor";
import type { BuiltinPlugin } from "./types";

export * from "./types";
export { RESET_LINK_ROUTING_ID };
export { coreExportPlugin, coreImportPlugin, coreCanvasPlugin, coreEditorPlugin };

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  coreExportPlugin,
  coreImportPlugin,
  coreCanvasPlugin,
  coreEditorPlugin,
];
