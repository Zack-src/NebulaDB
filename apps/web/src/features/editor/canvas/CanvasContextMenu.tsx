import { FrameIcon, NoteIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
import { CONTEXT_MENU_CLASS, CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { CanvasPoint } from "./types";

export interface CanvasContextMenuState {
  screenX: number;
  screenY: number;
  flowPosition: CanvasPoint;
}

export interface CanvasContextMenuProps {
  menu: CanvasContextMenuState;
  onAddTable: (position: CanvasPoint) => void;
  onAddZone: (position: CanvasPoint) => void;
  onAddNote: (position: CanvasPoint) => void;
  onAddEnum: (position: CanvasPoint) => void;
  onClose: () => void;
}

/** Right-click-on-empty-canvas menu — the only way to add a node besides editing DBML directly. */
export function CanvasContextMenu({
  menu,
  onAddTable,
  onAddZone,
  onAddNote,
  onAddEnum,
  onClose,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();

  const addAtCursor = (add: (position: CanvasPoint) => void) => {
    add(menu.flowPosition);
    onClose();
  };

  const items = [
    { icon: <TableIcon size={14} />, labelKey: "canvas.addTable", add: onAddTable },
    { icon: <FrameIcon size={14} />, labelKey: "canvas.addZone", add: onAddZone },
    { icon: <NoteIcon size={14} />, labelKey: "canvas.addNote", add: onAddNote },
    { icon: <TagIcon size={14} />, labelKey: "canvas.addEnum", add: onAddEnum },
  ] as const;

  return (
    <div
      className={CONTEXT_MENU_CLASS}
      style={{ left: menu.screenX, top: menu.screenY }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button key={item.labelKey} className={CONTEXT_MENU_ITEM_CLASS} onClick={() => addAtCursor(item.add)}>
          {item.icon} {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}
