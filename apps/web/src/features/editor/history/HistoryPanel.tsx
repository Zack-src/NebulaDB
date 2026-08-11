import { useEffect, useRef, useState } from "react";
import type { Project, RevisionMeta } from "@athanordb/shared";
import { diffProjects, type ChangeStatus, type ProjectDiff } from "@athanordb/dbml-engine";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { formatDateTime } from "@/i18n/formatters";
import { describeApiError } from "@/i18n/serverErrorMessages";
import { useTranslation } from "@/i18n/useTranslation";
import { exportRevisionDbml, fetchRevisionProject, fetchRevisions, labelRevision, restoreRevision } from "@/services/projectsApi";

const DIFF_ROW_CLASS: Record<ChangeStatus, string> = {
  added: "text-success",
  removed: "text-danger",
  changed: "text-warning",
};
const DIFF_SIGN: Record<ChangeStatus, string> = { added: "+", removed: "-", changed: "~" };

function DiffSummary({ diff }: { diff: ProjectDiff }) {
  const { t } = useTranslation();
  const { tables, refs } = diff;

  if (tables.length === 0 && refs.length === 0) {
    return <div className="text-xs text-text-muted">{t("history.noChanges")}</div>;
  }

  return (
    <div>
      {tables.map((table) => (
        <div key={table.id} className={`font-mono text-xs leading-relaxed ${DIFF_ROW_CLASS[table.status]}`}>
          {`${DIFF_SIGN[table.status]} Table ${table.renamedFrom ? `${table.renamedFrom} → ${table.name}` : table.name}`}
          {table.fields.length > 0 && (
            <span className="text-text-muted">
              {" "}
              ({table.fields.map((field) => `${DIFF_SIGN[field.status]}${field.name}`).join(", ")})
            </span>
          )}
        </div>
      ))}
      {refs.map((ref) => (
        <div key={ref.id} className={`font-mono text-xs leading-relaxed ${DIFF_ROW_CLASS[ref.status]}`}>
          {DIFF_SIGN[ref.status]} Ref{(ref.after ?? ref.before)?.name ? ` ${(ref.after ?? ref.before)!.name}` : ""}
        </div>
      ))}
    </div>
  );
}

export interface HistoryPanelProps {
  projectId: string;
  currentProject: Project;
  onClose: () => void;
}

/**
 * Revision timeline: list of past revisions (author + timestamp), DBML preview
 * of whichever one is selected, a schema-level diff against the current live
 * state (`diffProjects` — safe client-side, unlike `dbml.ts`'s exports, since
 * it has no `@dbml/core` import to drag in), and a restore button hitting the
 * non-destructive restore endpoint (creates a new revision rather than
 * rewriting history).
 */
function HistoryPanel({ projectId, currentProject, onClose }: HistoryPanelProps) {
  const { t, locale } = useTranslation();
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [diff, setDiff] = useState<ProjectDiff | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRevisions(projectId)
      .then((loaded) => {
        setRevisions(loaded as RevisionMeta[]);
        if (loaded.length > 0) setSelectedId(loaded[loaded.length - 1].id);
      })
      .catch((err: unknown) => setError(describeApiError(err, t)));
  }, [projectId, t]);

  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch this same effect kicks off
    setLoadingPreview(true);
    Promise.all([exportRevisionDbml(projectId, selectedId), fetchRevisionProject(projectId, selectedId)])
      .then(([dbml, revisionProject]) => {
        setPreview(dbml);
        setDiff(diffProjects(revisionProject, currentProject));
      })
      .catch((err: unknown) => setError(describeApiError(err, t)))
      .finally(() => setLoadingPreview(false));
    // `currentProject` deliberately excluded: it's a new object on every doc
    // change, and re-diffing on every remote edit while the panel is open would
    // be noisy — the comparison point is "this revision vs. what was on screen
    // when I picked it".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, projectId, t]);

  const saveLabel = useAsyncAction(async () => {
    if (!selectedId || !labelInputRef.current) return;
    const label = labelInputRef.current.value.trim() || null;
    await labelRevision(projectId, selectedId, label);
    setRevisions((current) => current.map((rev) => (rev.id === selectedId ? { ...rev, label } : rev)));
  });

  const restore = useAsyncAction(async () => {
    if (!selectedId) return;
    await restoreRevision(projectId, selectedId);
    onClose();
  });

  const loadingLabel = t("common.loading");

  return (
    <Modal title={t("history.title")} onClose={onClose} wide>
      <div className="flex h-[440px]">
        <ul className="w-[210px] shrink-0 list-none overflow-y-auto border-r border-border p-1.5 m-0">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                className={`mb-0.5 block w-full rounded-sm px-[9px] py-2 text-left transition-colors duration-100 hover:bg-surface-hover ${
                  revision.id === selectedId ? "!bg-primary-light" : ""
                }`}
                onClick={() => setSelectedId(revision.id)}
              >
                <div className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold text-text">
                  {revision.label ? `🏷 ${revision.label}` : revision.author}
                </div>
                <div className="mt-px text-[11px] text-text-muted">
                  {revision.label
                    ? `${revision.author} · ${formatDateTime(revision.createdAt, locale)}`
                    : formatDateTime(revision.createdAt, locale)}
                </div>
              </button>
            </li>
          ))}
          {revisions.length === 0 && <li className="p-2 text-xs text-text-muted">{t("history.empty")}</li>}
        </ul>
        <div className="flex min-w-0 flex-1 flex-col px-3.5 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex flex-1 gap-1.5">
              <input
                key={selectedId}
                ref={labelInputRef}
                className={`${INPUT_CLASS} flex-1`}
                defaultValue={revisions.find((revision) => revision.id === selectedId)?.label ?? ""}
                placeholder={t("history.labelPlaceholder")}
                disabled={!selectedId}
              />
              <Button size="sm" onClick={() => void saveLabel.run()} disabled={!selectedId || saveLabel.pending}>
                {saveLabel.pending ? t("common.saving") : t("history.label")}
              </Button>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void restore.run()}
              disabled={!selectedId || restore.pending}
            >
              {restore.pending ? t("history.restoring") : t("history.restore")}
            </Button>
          </div>
          <div className="mb-2.5 max-h-[120px] overflow-y-auto rounded-sm border border-border bg-[var(--color-bg-canvas)] px-2.5 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              {t("history.changesSince")}
            </div>
            {loadingPreview ? (
              <div className="text-xs text-text-muted">{loadingLabel}</div>
            ) : (
              diff && <DiffSummary diff={diff} />
            )}
          </div>
          <textarea readOnly className={`${TEXTAREA_CODE_CLASS} flex-1`} value={loadingPreview ? loadingLabel : preview} />
        </div>
      </div>
      {(error ?? saveLabel.error ?? restore.error) && <ErrorText>{error ?? saveLabel.error ?? restore.error}</ErrorText>}
    </Modal>
  );
}

export { HistoryPanel };
export default HistoryPanel;
