import { useMemo, useState } from "react";
import { translateType, type DatabaseEngine, type Project } from "@athanordb/shared";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Hint } from "@/components/ui/Alert";
import { SELECT_CLASS, CHECKBOX_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";

const ENGINES: DatabaseEngine[] = ["postgres", "mysql", "mssql", "sqlite", "oracle"];

interface TypeChange {
  key: string;
  tableId: string;
  tableName: string;
  fieldId: string;
  fieldName: string;
  from: string;
  to: string;
}

/**
 * Project-wide "convert column types" action — walks every field currently
 * on the canvas and offers to rewrite the ones `translateType` (see
 * `@athanordb/shared/typeMapping`) finds incompatible with a chosen target
 * engine, the same logic the deploy/export type-translation risk uses. This
 * is a plain, one-off canvas edit: it goes through `convertFieldTypes` (a
 * single Yjs transaction, same shape as `setTablesColor`), not the
 * deploy/export flow, so there's no live database involved and no
 * confirmation wizard beyond this dialog's own preview + checkboxes.
 */
export function ConvertTypesModal(props: {
  project: Project;
  onApply: (changes: { tableId: string; fieldId: string; newType: string }[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [targetEngine, setTargetEngine] = useState<DatabaseEngine>("postgres");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const changes = useMemo<TypeChange[]>(() => {
    const result: TypeChange[] = [];
    for (const table of props.project.tables) {
      for (const field of table.fields) {
        const translation = translateType(field.type, targetEngine);
        if (!translation.changed) continue;
        result.push({
          key: `${table.id}:${field.id}`,
          tableId: table.id,
          tableName: table.name,
          fieldId: field.id,
          fieldName: field.name,
          from: field.type,
          to: translation.type,
        });
      }
    }
    return result;
  }, [props.project, targetEngine]);

  // Excluding by key means switching the target engine (which reshuffles which
  // fields even show up) never leaves a stale exclusion silently suppressing an
  // unrelated row — a key not present in the new `changes` list is simply inert.
  const selected = changes.filter((c) => !excluded.has(c.key));

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apply = () => {
    props.onApply(selected.map((c) => ({ tableId: c.tableId, fieldId: c.fieldId, newType: c.to })));
    props.onClose();
  };

  return (
    <Modal title={t("convertTypes.title")} onClose={props.onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">{t("convertTypes.targetEngine")}</label>
          <select
            className={SELECT_CLASS}
            value={targetEngine}
            onChange={(e) => {
              setTargetEngine(e.target.value as DatabaseEngine);
              setExcluded(new Set());
            }}
          >
            {ENGINES.map((engine) => (
              <option key={engine} value={engine}>
                {t(`connections.engine.${engine}` as const)}
              </option>
            ))}
          </select>
        </div>

        {changes.length === 0 ? (
          <Hint>{t("convertTypes.noChanges")}</Hint>
        ) : (
          <>
            <Hint>{t("convertTypes.previewHint", { count: changes.length })}</Hint>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-sm border border-border bg-surface p-2">
              {changes.map((c) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={!excluded.has(c.key)}
                    onChange={() => toggle(c.key)}
                  />
                  <span className="font-mono text-text">
                    {c.tableName}.{c.fieldName}
                  </span>
                  <span className="font-mono text-text-muted">
                    {c.from} → {c.to}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={apply} disabled={selected.length === 0}>
            {t("convertTypes.apply", { count: selected.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
