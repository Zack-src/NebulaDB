import type { JSX } from "react";
import type { DetailLevel } from "@athanordb/shared";
import { FrameIcon, LinkIcon, MinimapIcon, NoteIcon, SearchIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
import {
  CANVAS_TOOLBAR_CLASS,
  CANVAS_TOOLBAR_DIVIDER_CLASS,
  CANVAS_TOOLBAR_ICON_BTN_CLASS,
  CANVAS_TOOLBAR_SEGMENT_CLASS,
  CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
} from "@/components/ui/canvasToolbarStyles";
import { useTranslation } from "@/i18n/useTranslation";
import { FONT_SCALE_MAX, FONT_SCALE_MIN, FONT_SCALE_STEP } from "@/utils/preferences";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import type { TranslationKeyOf } from "@/types";
import { DetailLevelDropdown } from "./DetailLevelDropdown";
import { PluginMenu } from "./PluginMenu";
import type { CanvasPoint } from "./types";

const INSERT_ICON_SIZE = 17;
const TOGGLE_ICON_SIZE = 16;

export interface CanvasToolbarProps {
  /** False for a `view` grant — the insert group disappears; the display toggles stay, they only change what you see. */
  canWrite: boolean;
  onAddTable: (position: CanvasPoint) => void;
  onAddZone: (position: CanvasPoint) => void;
  onAddNote: (position: CanvasPoint) => void;
  onAddEnum: (position: CanvasPoint) => void;
  /** Resolves the flow-space point a toolbar insert should drop a node at. */
  insertPosition: () => CanvasPoint;
  fontScale: number;
  onAdjustFontScale: (delta: number) => void;
  activeDetailLevel: DetailLevel | null;
  onSetDetailLevel: (level: DetailLevel) => void;
  highlightLinks: boolean;
  onHighlightLinksChange: (highlight: boolean) => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  searchOpen: boolean;
  onOpenSearch: () => void;
  canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
  onRunCanvasCommand: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
}

/**
 * The bottom-centre pill: inserts, display options and plugin commands. Zoom
 * lives in its own pill bottom-left (`CanvasZoomBar`), mirroring dbdiagram —
 * the two are used at different moments and were previously crowded into one
 * bar wide enough to reach the middle of the canvas.
 */
export function CanvasToolbar(props: CanvasToolbarProps) {
  const { t } = useTranslation();

  const insertButtons: { icon: JSX.Element; labelKey: TranslationKeyOf; add: (position: CanvasPoint) => void }[] = [
    { icon: <TableIcon size={INSERT_ICON_SIZE} />, labelKey: "canvas.addTable", add: props.onAddTable },
    { icon: <FrameIcon size={INSERT_ICON_SIZE} />, labelKey: "canvas.addZone", add: props.onAddZone },
    { icon: <NoteIcon size={INSERT_ICON_SIZE} />, labelKey: "canvas.addNote", add: props.onAddNote },
    { icon: <TagIcon size={INSERT_ICON_SIZE} />, labelKey: "canvas.addEnum", add: props.onAddEnum },
  ];

  const toggles: {
    icon: JSX.Element;
    active: boolean;
    tooltipKey: TranslationKeyOf;
    labelKey: TranslationKeyOf;
    onClick: () => void;
  }[] = [
    {
      icon: <LinkIcon size={TOGGLE_ICON_SIZE} />,
      active: props.highlightLinks,
      tooltipKey: props.highlightLinks ? "canvas.hideLinkHighlight" : "canvas.showLinkHighlight",
      labelKey: "canvas.toggleLinkHighlight",
      onClick: () => props.onHighlightLinksChange(!props.highlightLinks),
    },
    {
      icon: <MinimapIcon size={TOGGLE_ICON_SIZE} />,
      active: props.minimapVisible,
      tooltipKey: props.minimapVisible ? "canvas.hideMinimap" : "canvas.showMinimap",
      labelKey: "canvas.toggleMinimap",
      onClick: props.onToggleMinimap,
    },
    {
      icon: <SearchIcon size={TOGGLE_ICON_SIZE} />,
      active: props.searchOpen,
      tooltipKey: "canvas.findTable",
      labelKey: "canvas.findTable",
      onClick: props.onOpenSearch,
    },
  ];

  return (
    <div className={CANVAS_TOOLBAR_CLASS}>
      {props.canWrite && (
        <>
          {insertButtons.map(({ icon, labelKey, add }) => (
            <button
              key={labelKey}
              type="button"
              className={CANVAS_TOOLBAR_ICON_BTN_CLASS}
              onClick={() => add(props.insertPosition())}
              data-tooltip={t(labelKey)}
              data-tooltip-pos="bottom"
              aria-label={t(labelKey)}
            >
              {icon}
            </button>
          ))}
          <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
        </>
      )}

      <DetailLevelDropdown value={props.activeDetailLevel} onChange={props.onSetDetailLevel} />

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <div className="flex items-center" data-tooltip={t("canvas.textSize")} data-tooltip-pos="bottom">
        <button
          type="button"
          className={`${CANVAS_TOOLBAR_SEGMENT_CLASS} !px-2 hover:text-text`}
          onClick={() => props.onAdjustFontScale(-FONT_SCALE_STEP)}
          disabled={props.fontScale <= FONT_SCALE_MIN}
          data-tooltip={t("canvas.textSizeDecrease")}
          data-tooltip-pos="bottom"
        >
          <span className="text-[12px] font-bold leading-none">A⁻</span>
        </button>
        <span className="min-w-[38px] text-center font-mono text-[12.5px] font-medium text-text-muted">
          {Math.round(props.fontScale * 100)}%
        </span>
        <button
          type="button"
          className={`${CANVAS_TOOLBAR_SEGMENT_CLASS} !px-2 hover:text-text`}
          onClick={() => props.onAdjustFontScale(FONT_SCALE_STEP)}
          disabled={props.fontScale >= FONT_SCALE_MAX}
          data-tooltip={t("canvas.textSizeIncrease")}
          data-tooltip-pos="bottom"
        >
          <span className="text-[14px] font-bold leading-none">A⁺</span>
        </button>
      </div>

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      {toggles.map(({ icon, active, tooltipKey, labelKey, onClick }) => (
        <button
          key={labelKey}
          type="button"
          className={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${active ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
          onClick={onClick}
          aria-pressed={active}
          data-tooltip={t(tooltipKey)}
          data-tooltip-pos="bottom"
          aria-label={t(labelKey)}
        >
          {icon}
        </button>
      ))}

      <span className={CANVAS_TOOLBAR_DIVIDER_CLASS} />
      <PluginMenu
        commands={props.canvasCommands}
        onRun={props.onRunCanvasCommand}
        onOpenPlugins={props.onOpenPlugins}
      />
    </div>
  );
}
