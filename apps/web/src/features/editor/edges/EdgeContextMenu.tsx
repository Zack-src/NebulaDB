import { createPortal } from "react-dom";
import type { EdgeContextMenuState } from "@/features/editor/edges/useEdgeRouting";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import { useTranslation } from "@/i18n/useTranslation";

/** Right-click menu on an edge's path or a specific waypoint — also reachable from the gear button on the selected-edge toolbar. Portaled to document.body for precise positioning. */
export function EdgeContextMenu(props: {
  menu: EdgeContextMenuState;
  onInsertPoint: (position: EdgeContextMenuState["flowPosition"]) => void;
  onDeletePoint: (index: number) => void;
  onResetRouting: () => void;
  onResetColor?: () => void;
  onDeleteRef?: () => void;
}) {
  const { t } = useTranslation();

  return createPortal(
    <div
      className="fixed z-[9999] min-w-[176px] animate-modal-in rounded-lg border border-border/80 bg-surface-raised/95 p-1.5 shadow-2xl glass-panel nodrag nopan text-xs font-medium"
      style={{ left: props.menu.x, top: props.menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {props.menu.pointIndex !== undefined ? (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={() => props.onDeletePoint(props.menu.pointIndex!)}>
          {t("edge.deleteWaypoint")}
        </button>
      ) : (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={() => props.onInsertPoint(props.menu.flowPosition)}>
          {t("edge.insertWaypoint")}
        </button>
      )}
      <button className={CONTEXT_MENU_ITEM_CLASS} onClick={props.onResetRouting}>
        {t("edge.resetPathShort")}
      </button>
      {props.onResetColor && (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={props.onResetColor}>
          {t("edge.resetColor")}
        </button>
      )}
      {props.onDeleteRef && (
        <button className={`${CONTEXT_MENU_ITEM_CLASS} text-danger hover:bg-danger/10`} onClick={props.onDeleteRef}>
          {t("edge.deleteRelation")}
        </button>
      )}
    </div>,
    document.body,
  );
}
