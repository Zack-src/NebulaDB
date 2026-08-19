import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_NAME_LENGTH, type Table, type TableIndex } from "@athanordb/shared";
import { KeyIcon, PlusIcon, SettingsIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SWATCH_CELL_CLASS, SWATCH_CELL_ACTIVE_CLASS, SWATCH_GRID_CLASS } from "@/components/inputs/ColorSwatchPicker";
import { useAnchoredPlacement } from "@/hooks/useMenuPlacement";
import { useCloseOnViewportChange } from "@/hooks/useCloseOnViewportChange";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";
import {
  POPOVER_GROUP_CLASS,
  POPOVER_HEADER_CLASS,
  POPOVER_INPUT_CLASS,
  POPOVER_LABEL_CLASS,
  POPOVER_TITLE_CLASS,
} from "@/features/editor/nodes/table/tableStyles";

export const DEFAULT_HEADER_COLOR = "#334155";

export type IndexOptions = { unique?: boolean; pk?: boolean; name?: string };

/**
 * Add-index mini-form: pick 2+ columns (one is just "make this field
 * pk/unique", already covered by the column popover), unique/pk, an optional
 * name.
 */
function AddIndexForm({
  table,
  onAdd,
  onCancel,
}: {
  table: Table;
  onAdd: (fieldIds: string[], options: IndexOptions) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [primaryKey, setPrimaryKey] = useState(false);
  const [indexName, setIndexName] = useState("");

  const toggleField = (id: string) => {
    setSelectedFieldIds((current) => (current.includes(id) ? current.filter((f) => f !== id) : [...current, id]));
  };

  const submit = () => {
    if (selectedFieldIds.length === 0) return;
    onAdd(selectedFieldIds, {
      unique: unique || undefined,
      pk: primaryKey || undefined,
      name: indexName.trim() || undefined,
    });
    onCancel();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-strong/80 bg-surface p-2.5">
      <label className={POPOVER_LABEL_CLASS}>{t("table.index.columns")}</label>
      <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
        {table.fields.map((field) => (
          <label key={field.id} className="flex items-center gap-1.5 text-xs text-text">
            <input
              type="checkbox"
              className="accent-primary"
              checked={selectedFieldIds.includes(field.id)}
              onChange={() => toggleField(field.id)}
            />
            <span className="font-mono">{field.name}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text">
          <input
            type="checkbox"
            className="accent-primary"
            checked={unique}
            onChange={(event) => setUnique(event.target.checked)}
          />
          {t("field.unique")}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text">
          <input
            type="checkbox"
            className="accent-primary"
            checked={primaryKey}
            onChange={(event) => setPrimaryKey(event.target.checked)}
          />
          {t("field.primaryKey")}
        </label>
      </div>
      <input
        className={POPOVER_INPUT_CLASS}
        value={indexName}
        onChange={(event) => setIndexName(event.target.value)}
        placeholder={t("table.index.namePlaceholder")}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="sm" disabled={selectedFieldIds.length === 0} onClick={submit}>
          {t("common.create")}
        </Button>
      </div>
    </div>
  );
}

function IndexRow({
  index,
  table,
  onUpdate,
  onDelete,
}: {
  index: TableIndex;
  table: Table;
  onUpdate?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
  onDelete?: (indexId: string) => void;
}) {
  const { t } = useTranslation();
  const columnNames = index.fieldIds.map((id) => table.fields.find((field) => field.id === id)?.name ?? "?").join(", ");

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" data-tooltip={columnNames}>
        {columnNames}
      </span>
      {index.pk && (
        <Badge tone="warning" className="shrink-0 inline-flex items-center gap-0.5">
          <KeyIcon size={9} /> PK
        </Badge>
      )}
      <button
        type="button"
        className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase ${
          index.unique ? "bg-primary-light text-primary" : "text-text-muted hover:text-text"
        }`}
        onClick={() => onUpdate?.(index.id, { unique: !index.unique })}
        data-tooltip={t("table.index.toggleUnique")}
      >
        {t("table.index.uniqueShort")}
      </button>
      <Button
        variant="danger-ghost"
        size="icon"
        onClick={() => onDelete?.(index.id)}
        data-tooltip={t("table.index.delete")}
      >
        <TrashIcon size={12} />
      </Button>
    </div>
  );
}

export interface TableSettingsPopoverProps {
  table: Table;
  palette: string[];
  onRename: (name: string) => void;
  onStyleChange: (color: string | undefined, borderColor: string | undefined) => void;
  onAddIndex?: (fieldIds: string[], options: IndexOptions) => void;
  onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
  onDeleteIndex?: (indexId: string) => void;
  triggerClassName: string;
}

/**
 * Table header's gear button — popover to rename the table, pick its header
 * colour, and manage its indexes (including composite primary keys).
 */
export function TableSettingsPopover({
  table,
  palette,
  onRename,
  onStyleChange,
  onAddIndex,
  onUpdateIndex,
  onDeleteIndex,
  triggerClassName,
}: TableSettingsPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [addingIndex, setAddingIndex] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const name = useDraftValue(table.name, (next) => onRename(next!));

  const dismiss = useCallback(() => {
    setOpen(false);
    setAddingIndex(false);
  }, []);
  useDismissablePopover(open, dismiss, [popoverRef, triggerRef]);
  useCloseOnViewportChange(open, dismiss);
  // Placement (and, crucially, the height cap) is derived from the *table's*
  // rect, not just the trigger button's — anchoring to the right of the whole
  // table so the popover sits beside it instead of dropping down over it. The
  // old clamp measured against a guessed 280px while the panel was free to
  // grow to 80vh, so a tall settings popover hung off the screen.
  const placement = useAnchoredPlacement(open ? triggerRect : null, popoverRef, "right");

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const tableRect = triggerRef.current.closest(".table-node")?.getBoundingClientRect();
      setTriggerRect(tableRect ?? triggerRef.current.getBoundingClientRect());
    } else {
      setAddingIndex(false);
    }
    setOpen((current) => !current);
  };

  const currentColor = table.style?.color ?? DEFAULT_HEADER_COLOR;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`nodrag ${triggerClassName}${open ? " has-open-popover" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleOpen();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        data-tooltip={t("table.settingsTooltip")}
      >
        <SettingsIcon size={13} />
      </button>
      {open &&
        triggerRect &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[var(--z-popover)] flex w-[300px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-lg nodrag"
            style={placement ?? { left: triggerRect.left, top: triggerRect.bottom + 6, visibility: "hidden" }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={POPOVER_HEADER_CLASS}>
              <span className={POPOVER_TITLE_CLASS}>{t("table.settingsTitle")}</span>
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("table.nameLabel")}</label>
              <input
                className={POPOVER_INPUT_CLASS}
                value={name.value}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => name.setValue(event.target.value)}
                onBlur={() => name.commit()}
                onKeyDown={name.handleKeyDown}
                placeholder={t("table.namePlaceholder")}
              />
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("table.headerColor")}</label>
              <div className={`${SWATCH_GRID_CLASS} mt-1`}>
                {palette.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`${SWATCH_CELL_CLASS} ${color.toLowerCase() === currentColor.toLowerCase() ? SWATCH_CELL_ACTIVE_CLASS : ""}`}
                    style={{ background: color }}
                    onClick={() => onStyleChange(color, table.style?.borderColor)}
                    data-tooltip={color}
                  />
                ))}
              </div>
            </div>

            {(onAddIndex || table.indexes.length > 0) && (
              <div className={POPOVER_GROUP_CLASS}>
                <div className="flex items-center justify-between">
                  <label className={POPOVER_LABEL_CLASS}>
                    {t("table.index.sectionTitle")} {table.indexes.length > 0 && `(${table.indexes.length})`}
                  </label>
                  {onAddIndex && !addingIndex && (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover"
                      onClick={() => setAddingIndex(true)}
                    >
                      <PlusIcon size={11} /> {t("common.add")}
                    </button>
                  )}
                </div>

                {table.indexes.length === 0 && !addingIndex && (
                  <p className="text-[11px] italic text-text-muted">{t("table.index.empty")}</p>
                )}

                <div className="flex flex-col gap-1.5">
                  {table.indexes.map((index) => (
                    <IndexRow
                      key={index.id}
                      index={index}
                      table={table}
                      onUpdate={onUpdateIndex}
                      onDelete={onDeleteIndex}
                    />
                  ))}
                </div>

                {addingIndex && onAddIndex && (
                  <AddIndexForm table={table} onAdd={onAddIndex} onCancel={() => setAddingIndex(false)} />
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
