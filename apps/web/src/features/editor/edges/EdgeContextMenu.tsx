import { createPortal } from "react-dom";
import type { EdgeContextMenuState } from "@/features/editor/edges/useEdgeRouting";
import { PlusIcon, RestoreIcon, PaletteIcon, TrashIcon } from "@/components/icons/Icons";
import {
  CONTEXT_MENU_CLASS,
  CONTEXT_MENU_DANGER_ITEM_CLASS,
  CONTEXT_MENU_ITEM_CLASS,
  CONTEXT_MENU_SEPARATOR_CLASS,
} from "@/components/ui/contextMenuStyles";
import { useMenuPlacement } from "@/hooks/useMenuPlacement";
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
  const { ref, style } = useMenuPlacement(props.menu.x, props.menu.y);
  const destructive = props.onDeleteRef;

  return createPortal(
    <div
      ref={ref}
      className={`${CONTEXT_MENU_CLASS} nodrag nopan`}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {props.menu.pointIndex !== undefined ? (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={() => props.onDeletePoint(props.menu.pointIndex!)}>
          <TrashIcon size={14} />
          {t("edge.deleteWaypoint")}
        </button>
      ) : (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={() => props.onInsertPoint(props.menu.flowPosition)}>
          <PlusIcon size={14} />
          {t("edge.insertWaypoint")}
        </button>
      )}
      <button className={CONTEXT_MENU_ITEM_CLASS} onClick={props.onResetRouting}>
        <RestoreIcon size={14} />
        {t("edge.resetPathShort")}
      </button>
      {props.onResetColor && (
        <button className={CONTEXT_MENU_ITEM_CLASS} onClick={props.onResetColor}>
          <PaletteIcon size={14} />
          {t("edge.resetColor")}
        </button>
      )}
      {destructive && (
        <>
          <div className={CONTEXT_MENU_SEPARATOR_CLASS} />
          <button className={CONTEXT_MENU_DANGER_ITEM_CLASS} onClick={destructive}>
            <TrashIcon size={14} />
            {t("edge.deleteRelation")}
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
