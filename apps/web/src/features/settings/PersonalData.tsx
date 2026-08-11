import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { DownloadIcon, TrashIcon } from "@/components/icons/Icons";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { deleteMyAccount, MY_DATA_EXPORT_URL } from "@/services/usersApi";

/**
 * The two rights a user has over their own data: get a copy of it, and have
 * the account removed. Both were missing entirely — deletion could only be
 * done by an administrator, and there was no export at all.
 */
export function PersonalData() {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A hard navigation rather than unwinding React state: once the account is
  // gone, every piece of in-memory state — session, projects, open document —
  // refers to something that no longer exists. Reloading is both simpler and
  // more honest than trying to tear it down gracefully.
  const returnToStart = () => window.location.assign("/");

  return (
    <div className="pt-6 border-t border-border/60">
      <h3 className="text-sm font-bold text-text mb-1">{t("settings.personalData.title")}</h3>
      <p className="text-xs text-text-muted mb-4">{t("settings.personalData.description")}</p>

      <div className="flex flex-wrap gap-2">
        <a
          href={MY_DATA_EXPORT_URL}
          download
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong/90 bg-surface-raised/50 px-3.5 py-1.5 text-[13px] font-semibold text-text transition-colors hover:border-primary/80 hover:bg-surface-hover"
        >
          <DownloadIcon size={14} /> {t("settings.personalData.export")}
        </a>
        <Button variant="danger" className="gap-1.5 text-xs" onClick={() => setConfirmOpen(true)}>
          <TrashIcon size={13} /> {t("settings.personalData.deleteAccount")}
        </Button>
      </div>

      {confirmOpen && <DeleteAccountModal onClose={() => setConfirmOpen(false)} onDeleted={returnToStart} />}
    </div>
  );
}

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const deleteAccount = useAsyncAction(async () => {
    await deleteMyAccount(password);
    onDeleted();
  });

  return (
    <Modal title={t("settings.personalData.deleteAccount")} onClose={onClose}>
      <Hint>{t("settings.personalData.deleteConsequences")}</Hint>
      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        {t("settings.personalData.confirmWithPassword")}
        <input
          className={`${INPUT_CLASS} mt-1 w-full`}
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <Button
        variant="danger"
        className="mt-4"
        onClick={() => void deleteAccount.run()}
        disabled={deleteAccount.pending || !password}
      >
        {deleteAccount.pending ? t("common.deleting") : t("settings.personalData.deleteConfirm")}
      </Button>
      {deleteAccount.error && <ErrorText>{deleteAccount.error}</ErrorText>}
    </Modal>
  );
}
