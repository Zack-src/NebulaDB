import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_DEFAULT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TYPE_LENGTH,
  type Field,
} from "@athanordb/shared";
import { AsteriskIcon, DiamondIcon, IncrementIcon, KeyIcon, PencilIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { useAnchoredPlacement } from "@/hooks/useMenuPlacement";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useDraftValue } from "@/hooks/useDraftValue";
import { useTranslation } from "@/i18n/useTranslation";
import {
  FIELD_TYPE_CHIP_ACTIVE_CLASS,
  FIELD_TYPE_CHIP_CLASS,
  KW_TOGGLE_ACTIVE_CLASS,
  KW_TOGGLE_BASE_CLASS,
  POPOVER_GROUP_CLASS,
  POPOVER_HEADER_CLASS,
  POPOVER_INPUT_CLASS,
  POPOVER_INPUT_MONO_CLASS,
  POPOVER_LABEL_CLASS,
  POPOVER_TITLE_CLASS,
} from "@/features/editor/nodes/table/tableStyles";

const COMMON_TYPES = ["int", "varchar", "text", "boolean", "timestamp", "uuid", "json", "decimal", "bigint"];


export interface FieldEditorPopoverProps {
  field: Field;
  onUpdateField?: (fieldId: string, updates: Partial<Field>) => void;
  onDeleteField?: (fieldId: string) => void;
  triggerClassName: string;
}

/** Column's pencil button — popover to edit name/type/default/note and toggle pk/unique/notNull/increment. */
export function FieldEditorPopover({
  field,
  onUpdateField,
  onDeleteField,
  triggerClassName,
}: FieldEditorPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const update = (updates: Partial<Field>) => onUpdateField?.(field.id, updates);

  const name = useDraftValue(field.name, (next) => update({ name: next }));
  const type = useDraftValue(field.type, (next) => update({ type: next }));
  const defaultValue = useDraftValue(field.default ?? "", (next) => update({ default: next }), { allowEmpty: true });
  const note = useDraftValue(field.note ?? "", (next) => update({ note: next }), { allowEmpty: true });

  useDismissablePopover(open, () => setOpen(false), [popoverRef, triggerRef]);
  const placement = useAnchoredPlacement(open ? triggerRect : null, popoverRef);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen((current) => !current);
  };

  const attributeToggles = [
    { active: field.pk, activeClass: KW_TOGGLE_ACTIVE_CLASS.pk, icon: <KeyIcon size={12} />, labelKey: "field.primaryKey", tooltipKey: "field.primaryKeyTooltip", apply: () => update({ pk: !field.pk }) },
    { active: field.unique, activeClass: KW_TOGGLE_ACTIVE_CLASS.unique, icon: <DiamondIcon size={10} />, labelKey: "field.unique", tooltipKey: "field.uniqueTooltip", apply: () => update({ unique: !field.unique }) },
    { active: field.notNull, activeClass: KW_TOGGLE_ACTIVE_CLASS.notNull, icon: <AsteriskIcon size={11} />, labelKey: "field.notNull", tooltipKey: "field.notNullTooltip", apply: () => update({ notNull: !field.notNull }) },
    { active: field.increment, activeClass: KW_TOGGLE_ACTIVE_CLASS.increment, icon: <IncrementIcon size={11} />, labelKey: "field.increment", tooltipKey: "field.incrementTooltip", apply: () => update({ increment: !field.increment }) },
  ] as const;

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
        data-tooltip={t("field.editTooltip")}
      >
        <PencilIcon size={11} />
      </button>
      {open &&
        triggerRect &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] flex w-[296px] flex-col gap-3 rounded-lg border border-border-strong bg-surface-raised p-3.5 shadow-lg nodrag"
            style={placement ?? { left: triggerRect.left, top: triggerRect.bottom + 6, visibility: "hidden" }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={POPOVER_HEADER_CLASS}>
              <span className={POPOVER_TITLE_CLASS}>{t("field.propertiesTitle")}</span>
              <Button
                variant="danger-ghost"
                size="icon"
                onClick={() => {
                  onDeleteField?.(field.id);
                  setOpen(false);
                }}
                data-tooltip={t("field.delete")}
              >
                <TrashIcon size={13} />
              </Button>
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("field.nameLabel")}</label>
              <input
                autoFocus
                className={POPOVER_INPUT_CLASS}
                value={name.value}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => name.setValue(event.target.value)}
                onBlur={() => name.commit()}
                onKeyDown={name.handleKeyDown}
                placeholder={t("field.namePlaceholder")}
              />
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("field.typeLabel")}</label>
              <input
                className={POPOVER_INPUT_MONO_CLASS}
                value={type.value}
                maxLength={MAX_TYPE_LENGTH}
                onChange={(event) => type.setValue(event.target.value)}
                onBlur={() => type.commit()}
                onKeyDown={type.handleKeyDown}
                placeholder={t("field.typePlaceholder")}
              />
              <div className="mt-0.5 flex flex-wrap gap-1">
                {COMMON_TYPES.map((commonType) => (
                  <button
                    key={commonType}
                    type="button"
                    className={`${FIELD_TYPE_CHIP_CLASS} ${field.type === commonType ? FIELD_TYPE_CHIP_ACTIVE_CLASS : ""}`}
                    onClick={() => {
                      type.setValue(commonType);
                      type.commit(commonType);
                    }}
                  >
                    {commonType}
                  </button>
                ))}
              </div>
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("field.attributesLabel")}</label>
              <div className="grid grid-cols-2 gap-[5px]">
                {attributeToggles.map((toggle) => (
                  <button
                    key={toggle.labelKey}
                    type="button"
                    className={`${KW_TOGGLE_BASE_CLASS} ${toggle.active ? toggle.activeClass : ""}`}
                    onClick={toggle.apply}
                    data-tooltip={t(toggle.tooltipKey)}
                  >
                    {toggle.icon} {t(toggle.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("field.defaultLabel")}</label>
              <input
                className={POPOVER_INPUT_MONO_CLASS}
                value={defaultValue.value}
                maxLength={MAX_DEFAULT_LENGTH}
                onChange={(event) => defaultValue.setValue(event.target.value)}
                onBlur={() => defaultValue.commit()}
                onKeyDown={defaultValue.handleKeyDown}
                placeholder={t("field.defaultPlaceholder")}
              />
            </div>

            <div className={POPOVER_GROUP_CLASS}>
              <label className={POPOVER_LABEL_CLASS}>{t("field.noteLabel")}</label>
              <input
                className={POPOVER_INPUT_CLASS}
                value={note.value}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(event) => note.setValue(event.target.value)}
                onBlur={() => note.commit()}
                onKeyDown={note.handleKeyDown}
                placeholder={t("field.notePlaceholder")}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
