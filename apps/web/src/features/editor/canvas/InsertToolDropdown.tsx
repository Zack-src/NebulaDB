import { useState, type JSX } from "react";
import { ChevronRightIcon, FrameIcon, NoteIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import {
  CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
  CANVAS_TOOLBAR_SEGMENT_CLASS,
  CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKeyOf } from "@/types";
import { ToolbarMenu } from "./ToolbarMenu";
import type { CanvasInsertTool } from "./types";

const MENU_ICON_SIZE = 15;
const TRIGGER_ICON_SIZE = 16;

const TOOLS: { tool: CanvasInsertTool; icon: (size: number) => JSX.Element; labelKey: TranslationKeyOf }[] = [
  { tool: "table", icon: (size) => <TableIcon size={size} />, labelKey: "canvas.addTable" },
  { tool: "zone", icon: (size) => <FrameIcon size={size} />, labelKey: "canvas.addZone" },
  { tool: "note", icon: (size) => <NoteIcon size={size} />, labelKey: "canvas.addNote" },
  { tool: "enum", icon: (size) => <TagIcon size={size} />, labelKey: "canvas.addEnum" },
];

export interface InsertToolDropdownProps {
  /** The armed tool, or `null` in ordinary selection mode — see `CanvasArea`. */
  activeTool: CanvasInsertTool | null;
  onSelectTool: (tool: CanvasInsertTool) => void;
}

/**
 * The four insert tools (table, zone, note, enum), collapsed into one dropdown
 * — the same shape as the detail-level control — instead of four permanent
 * icon buttons crowding the toolbar.
 *
 * Picking an entry arms that tool and closes the menu (`CanvasArea` then
 * places it wherever the canvas is next clicked, as many times as clicked —
 * this component only shows which tool, if any, is armed). Picking the
 * already-armed tool again disarms it, mirroring the toggle every other
 * canvas tool uses; `CanvasArea`'s `onSelectTool` already implements that
 * flip, so this component just calls it unconditionally.
 */
export function InsertToolDropdown({ activeTool, onSelectTool }: InsertToolDropdownProps) {
  const { t } = useTranslation();
  // Keeps showing the last-picked tool's icon on the trigger after it's been
  // placed and disarmed, rather than resetting to a generic glyph — the same
  // "remembers the last shape" convention Figma's own tool dropdown uses.
  const [lastTool, setLastTool] = useState<CanvasInsertTool>("table");
  const displayedTool = activeTool ?? lastTool;
  const displayed = TOOLS.find((entry) => entry.tool === displayedTool) ?? TOOLS[0];

  return (
    <ToolbarMenu
      tooltip={t("canvas.insertTool.tooltip")}
      triggerClassName={(open) =>
        `${CANVAS_TOOLBAR_SEGMENT_CLASS} !px-2.5 ${
          activeTool ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""
        }`
      }
      triggerContent={
        <>
          {displayed.icon(TRIGGER_ICON_SIZE)}
          <ChevronRightIcon size={12} className="-rotate-90" />
        </>
      }
    >
      {(close) =>
        // Icon, then label, then an optional checkmark — three direct children
        // of the button rather than a wrapping span, because
        // `CONTEXT_MENU_ITEM_CLASS` colours the icon through a `[&>svg]`
        // selector that only matches an immediate child.
        TOOLS.map(({ tool, icon, labelKey }) => (
          <button
            key={tool}
            type="button"
            className={`${CONTEXT_MENU_ITEM_CLASS} ${tool === activeTool ? "text-text" : ""}`}
            onClick={() => {
              setLastTool(tool);
              onSelectTool(tool);
              close();
            }}
          >
            {icon(MENU_ICON_SIZE)}
            <span className="flex-1">{t(labelKey)}</span>
            {tool === activeTool && <span className="text-primary">✓</span>}
          </button>
        ))
      }
    </ToolbarMenu>
  );
}
