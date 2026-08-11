import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { useTranslation } from "@/i18n/useTranslation";
import type { ProjectSummary } from "@/types";

export interface DeleteProjectModalProps {
  target: ProjectSummary;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirms permanently deleting one trashed project (and its revision history). */
export function DeleteProjectModal({ target, busy, error, onConfirm, onClose }: DeleteProjectModalProps) {
  const { t } = useTranslation();

  return (
    <Modal title={t("projects.deleteForever.title")} onClose={onClose}>
      <Hint>{t("projects.deleteForever.confirmation", { name: target.name })}</Hint>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? t("common.deleting") : t("projects.deleteForever.action")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}
