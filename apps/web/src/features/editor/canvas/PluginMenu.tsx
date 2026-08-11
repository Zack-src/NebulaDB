import { PuzzleIcon } from "@/components/icons/Icons";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import {
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import { ToolbarMenu } from "./ToolbarMenu";

export interface PluginMenuProps {
  commands: ResolvedContribution<CanvasCommandContribution>[];
  onRun: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
}

/** Every canvas command contributed by a plugin, plus a way into the manager. */
export function PluginMenu({ commands, onRun, onOpenPlugins }: PluginMenuProps) {
  const { t } = useTranslation();

  return (
    <ToolbarMenu
      tooltip={t("canvas.plugins.tooltip")}
      minWidth={240}
      triggerClassName={(open) => `${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
      triggerContent={<PuzzleIcon size={16} />}
    >
      {(close) => (
        <>
          {commands.length === 0 && (
            <span className="block px-2.5 py-1.5 text-[12px] text-text-muted">{t("canvas.plugins.none")}</span>
          )}
          {commands.map((command) => (
            <button
              key={command.key}
              type="button"
              className={`${CONTEXT_MENU_ITEM_CLASS} justify-between`}
              onClick={() => {
                onRun(command);
                close();
              }}
              data-tooltip={command.contribution.description}
            >
              {command.contribution.label}
              <span className="ml-2 shrink-0 text-[10px] text-text-muted">
                {command.contribution.shortcut ?? (command.source === "user" ? command.plugin.name : "")}
              </span>
            </button>
          ))}
          <span className="my-1 block h-px bg-border" />
          <button
            type="button"
            className={CONTEXT_MENU_ITEM_CLASS}
            onClick={() => {
              onOpenPlugins();
              close();
            }}
          >
            {t("canvas.plugins.manage")}
          </button>
        </>
      )}
    </ToolbarMenu>
  );
}
