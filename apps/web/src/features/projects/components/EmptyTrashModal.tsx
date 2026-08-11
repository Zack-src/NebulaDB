import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";

export interface EmptyTrashModalProps {
  count: number;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirms permanently emptying the trash. Typing the exact word is the guard
 * against "misclick nukes everything" — a click-through confirm is not enough
 * friction for an action this destructive and irreversible. The word itself is
 * translated: asking a French reader to type an English word (or the reverse)
 * turns a deliberate check into a transcription puzzle.
 */
export function EmptyTrashModal({ count, busy, error, onConfirm, onClose }: EmptyTrashModalProps) {
  const { t } = useTranslation();
  const confirmWord = t("projects.emptyTrash.confirmWord");
  const [typedWord, setTypedWord] = useState("");

  return (
    <Modal title={t("projects.emptyTrash.title")} onClose={() => !busy && onClose()}>
      <Hint>{t("projects.emptyTrash.consequences", { count })}</Hint>
      <Hint>{t("projects.emptyTrash.typeToConfirm", { word: confirmWord })}</Hint>
      <input
        autoFocus
        className={`${INPUT_CLASS} w-full`}
        value={typedWord}
        onChange={(event) => setTypedWord(event.target.value)}
        placeholder={confirmWord}
        disabled={busy}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy || typedWord !== confirmWord}>
          {busy ? t("common.deleting") : t("projects.emptyTrash.action")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}
