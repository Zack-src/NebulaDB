import { LinkIcon, MinimapIcon, RestoreIcon, SearchIcon } from "@/components/icons/Icons";
import {
  CANVAS_TOOLBAR_DIVIDER_CLASS,
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { AnimatedToolbarPill } from "@/components/ui/AnimatedToolbarPill";
import { useTranslation } from "@/i18n/useTranslation";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import type { DetailLevel } from "@athanordb/shared";
import { DetailLevelDropdown } from "./DetailLevelDropdown";
import { InsertToolDropdown } from "./InsertToolDropdown";
import { PluginMenu } from "./PluginMenu";
import type { CanvasInsertTool } from "./types";
import { ViewModeToggle, type EditorViewMode } from "@/features/editor/mcd/ViewModeToggle";

const TOGGLE_ICON_SIZE = 16;

/** The one canvas command the app itself ships — kept out of the plugin menu, see `PluginMenu`. */
const RESET_LINK_ROUTING_ID = "reset-link-routing";

export interface CanvasToolbarProps {
  /** False for a `view` grant — the insert group disappears; the display toggles stay, they only change what you see. */
  canWrite: boolean;
  /** The armed insert tool, or `null` in ordinary selection mode — see `CanvasArea`. */
  activeTool: CanvasInsertTool | null;
  onSelectTool: (tool: CanvasInsertTool) => void;
  activeDetailLevel: DetailLevel | null;
  onSetDetailLevel: (level: DetailLevel) => void;
  highlightLinks: boolean;
  onHighlightLinksChange: (highlight: boolean) => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
  onRunCanvasCommand: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
  viewMode: EditorViewMode;
  onSetViewMode: (mode: EditorViewMode) => void;
}

/**
 * The bottom-centre pill: inserts, display options and plugin commands. Zoom
 * lives in its own pill bottom-left (`CanvasZoomBar`), mirroring dbdiagram —
 * the two are used at different moments and were previously crowded into one
 * bar wide enough to reach the middle of the canvas.
 *
 * Insert buttons arm a tool rather than dropping a node immediately — pick
 * "Table", then click the canvas as many times as there are tables to add,
 * the way Figma's shape tools work. `CanvasArea` owns the actual placement
 * (it has the flow-space click coordinate); this component only shows which
 * tool, if any, is armed.
 */
export function CanvasToolbar(props: CanvasToolbarProps) {
  const { t } = useTranslation();

  // The reset-link-routing command ships with the app (see builtins.ts) —
  // it used to only be reachable through the plugin dropdown, which read as
  // "this is some third-party plugin's action" for a core editing command.
  // Surfaced here as its own button; `PluginMenu` keeps only what real
  // plugins contribute.
  const resetLinkRoutingCommand = props.canvasCommands.find(
    (command) => command.source === "builtin" && command.contribution.id === RESET_LINK_ROUTING_ID,
  );

  return (
    <AnimatedToolbarPill pillId="editing-toolbar">
      <ViewModeToggle value={props.viewMode} onChange={props.onSetViewMode} />
      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />

      {props.canWrite && (
        <>
          <InsertToolDropdown activeTool={props.activeTool} onSelectTool={props.onSelectTool} />
          <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
        </>
      )}

      <DetailLevelDropdown value={props.activeDetailLevel} onChange={props.onSetDetailLevel} />

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <button
        type="button"
        className={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${props.highlightLinks ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
        onClick={() => props.onHighlightLinksChange(!props.highlightLinks)}
        aria-pressed={props.highlightLinks}
        // Locale-independent handle for the perf harness (scripts/bench-web.mjs),
        // which drives this exact button — every other selector here is a
        // translated string.
        data-testid="toggle-link-highlight"
        data-tooltip={t(props.highlightLinks ? "canvas.hideLinkHighlight" : "canvas.showLinkHighlight")}
        data-tooltip-pos="bottom"
        aria-label={t("canvas.toggleLinkHighlight")}
      >
        <LinkIcon size={TOGGLE_ICON_SIZE} />
      </button>
      {props.canWrite && resetLinkRoutingCommand && (
        <button
          type="button"
          className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
          onClick={() => props.onRunCanvasCommand(resetLinkRoutingCommand)}
          data-tooltip={t("canvas.resetLinkRouting")}
          data-tooltip-pos="bottom"
          aria-label={t("canvas.resetLinkRouting")}
        >
          <RestoreIcon size={TOGGLE_ICON_SIZE} />
        </button>
      )}

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <button
        type="button"
        className={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${props.minimapVisible ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
        onClick={props.onToggleMinimap}
        aria-pressed={props.minimapVisible}
        data-tooltip={t(props.minimapVisible ? "canvas.hideMinimap" : "canvas.showMinimap")}
        data-tooltip-pos="bottom"
        aria-label={t("canvas.toggleMinimap")}
      >
        <MinimapIcon size={TOGGLE_ICON_SIZE} />
      </button>
      <button
        type="button"
        className={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${props.searchOpen ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
        onClick={props.onToggleSearch}
        aria-pressed={props.searchOpen}
        data-tooltip={t(props.searchOpen ? "canvas.closeSearch" : "canvas.findTable")}
        data-tooltip-pos="bottom"
        aria-label={t("canvas.findTable")}
      >
        <SearchIcon size={TOGGLE_ICON_SIZE} />
      </button>

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <PluginMenu
        commands={props.canvasCommands}
        onRun={props.onRunCanvasCommand}
        onOpenPlugins={props.onOpenPlugins}
      />
    </AnimatedToolbarPill>
  );
}
