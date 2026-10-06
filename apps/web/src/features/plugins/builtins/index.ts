import { coreExportPlugin } from "./coreExport";
import { coreImportPlugin } from "./coreImport";
import { coreCanvasPlugin } from "./coreCanvas";
import { coreEditorPlugin } from "./coreEditor";
import type { BuiltinPlugin } from "./types";

export * from "./types";

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  coreExportPlugin,
  coreImportPlugin,
  coreCanvasPlugin,
  coreEditorPlugin,
];
