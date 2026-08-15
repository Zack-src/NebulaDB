import { PuzzleIcon } from "@/components/icons/Icons";
import {
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import { PluginQuickPalette } from "@/features/plugins/PluginQuickPalette";
import { ToolbarMenu } from "./ToolbarMenu";

export interface PluginMenuProps {
  commands: ResolvedContribution<CanvasCommandContribution>[];
  onRun: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
}

export function PluginMenu({ commands, onRun, onOpenPlugins }: PluginMenuProps) {
  const { t } = useTranslation();

  return (
    <ToolbarMenu
      tooltip={t("canvas.plugins.tooltip")}
      minWidth={300}
      triggerClassName={(open) => `${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
      triggerContent={<PuzzleIcon size={16} />}
    >
      {(close) => (
        <PluginQuickPalette commands={commands} onRun={onRun} onOpenPlugins={onOpenPlugins} onClose={close} />
      )}
    </ToolbarMenu>
  );
}
