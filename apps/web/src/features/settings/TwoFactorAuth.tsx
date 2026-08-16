import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { Field } from "@/components/ui/Field";
import { CheckIcon, KeyIcon } from "@/components/icons/Icons";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import {
  confirmTotpSetup,
  disableTotp,
  fetchTotpStatus,
  regenerateBackupCodes,
  startTotpSetup,
  type TotpSetup,
} from "@/services/authApi";

/**
 * Enable/disable two-factor login and manage backup codes.
 *
 * The three flows here (enroll, disable, regenerate codes) are split into
 * their own modal components rather than one growing form: each has its own
 * confirmation requirements (a fresh code to prove enrollment; a password
 * *and* a code to turn it off; a password alone to reissue codes) and its
 * own one-time reveal of sensitive output, so keeping them separate keeps
 * each one's state honest about what it actually needs.
 */
export function TwoFactorAuth() {
  const { t } = useTranslation();
  const status = useAsyncResource(fetchTotpStatus);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  // Shown once, right after either enrollment or a regeneration — same modal
  // for both, since the "save these now, they won't be shown again" message
  // is identical either way.
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);

  return (
    <div className="pt-6 border-t border-border/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-text mb-1">{t("totp.title")}</h3>
          <p className="text-xs text-text-muted max-w-md">{t("totp.subtitle")}</p>
        </div>
        {status.data && (
          <Badge tone={status.data.enabled ? "success" : "muted"}>
            {status.data.enabled ? t("totp.enabledBadge") : t("totp.disabledBadge")}
          </Badge>
        )}
      </div>

      {status.error && <ErrorText>{status.error}</ErrorText>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status.data?.enabled ? (
          <>
            <span className="text-xs text-text-muted">
              {t("totp.backupCodesRemaining", { count: status.data.backupCodesRemaining })}
            </span>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setRegenerateOpen(true)}>
              {t("totp.regenerateButton")}
            </Button>
            <Button size="sm" variant="danger-ghost" className="text-xs" onClick={() => setDisableOpen(true)}>
              {t("totp.disableButton")}
            </Button>
          </>
        ) : (
          <Button variant="outline" className="gap-2 text-xs" onClick={() => setWizardOpen(true)}>
            <KeyIcon size={14} /> {t("totp.enableButton")}
          </Button>
        )}
      </div>

      {wizardOpen && (
        <SetupWizard
          onClose={() => setWizardOpen(false)}
          onEnabled={(codes) => {
            setWizardOpen(false);
            setRevealedCodes(codes);
            status.reload();
          }}
        />
      )}
      {disableOpen && (
        <DisableModal
          onClose={() => setDisableOpen(false)}
          onDisabled={() => {
            setDisableOpen(false);
            status.reload();
          }}
        />
      )}
      {regenerateOpen && (
        <RegenerateModal
          onClose={() => setRegenerateOpen(false)}
          onRegenerated={(codes) => {
            setRegenerateOpen(false);
            setRevealedCodes(codes);
          }}
        />
      )}
      {revealedCodes && <BackupCodesModal codes={revealedCodes} onClose={() => setRevealedCodes(null)} />}
    </div>
  );
}

function SetupWizard(props: { onClose: () => void; onEnabled: (backupCodes: string[]) => void }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // One-shot on mount — re-runnable in principle (`POST /totp/setup` replaces
  // whatever secret was pending), but this component only ever mounts once
  // per "Enable 2FA" click, so a plain effect with an `active` guard is
  // enough; no retry button is wired to it.
  useEffect(() => {
    let active = true;
    startTotpSetup()
      .then((result) => {
        if (active) setSetup(result);
      })
      .catch((err: unknown) => {
        if (active) setSetupError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!setup) return;
    let active = true;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        // Non-fatal: the secret text field below still lets manual entry work.
      });
    return () => {
      active = false;
    };
  }, [setup]);

  const confirm = useAsyncAction(async () => {
    const result = await confirmTotpSetup(code);
    props.onEnabled(result.backupCodes);
  });

  return (
    <Modal title={t("totp.setupTitle")} onClose={props.onClose}>
      <div className="space-y-4">
        <Hint>{t("totp.setupIntro")}</Hint>

        {setupError && <ErrorText>{setupError}</ErrorText>}

        {qrDataUrl && (
          <img src={qrDataUrl} alt="" width={200} height={200} className="mx-auto rounded-lg border border-border" />
        )}

        {setup && (
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t("totp.secretLabel")}</span>
            <code className="block break-all rounded-md border border-border bg-surface-raised px-2.5 py-2 text-[11px] text-text">
              {setup.secret}
            </code>
          </div>
        )}

        <Field
          label={t("totp.codeLabel")}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t("totp.codePlaceholder")}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          autoFocus
        />

        {confirm.error && <ErrorText>{confirm.error}</ErrorText>}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={props.onClose} disabled={confirm.pending}>
            {t("totp.cancelSetup")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void confirm.run()}
            disabled={confirm.pending || code.length !== 6 || !setup}
          >
            {confirm.pending ? t("totp.verifying") : t("totp.verifyButton")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DisableModal(props: { onClose: () => void; onDisabled: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const disable = useAsyncAction(async () => {
    await disableTotp(password, code);
    props.onDisabled();
  });

  return (
    <Modal title={t("totp.disableConfirmTitle")} onClose={props.onClose}>
      <div className="space-y-4">
        <Hint>{t("totp.disableConfirmBody")}</Hint>
        <Field
          label={t("totp.disablePasswordLabel")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        <Field
          label={t("totp.disableCodeLabel")}
          type="text"
          autoComplete="one-time-code"
          placeholder={t("totp.codePlaceholder")}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        {disable.error && <ErrorText>{disable.error}</ErrorText>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={props.onClose} disabled={disable.pending}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void disable.run()}
            disabled={disable.pending || !password || !code}
          >
            {disable.pending ? t("common.saving") : t("totp.confirmDisable")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RegenerateModal(props: { onClose: () => void; onRegenerated: (codes: string[]) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const regenerate = useAsyncAction(async () => {
    const result = await regenerateBackupCodes(password);
    props.onRegenerated(result.backupCodes);
  });

  return (
    <Modal title={t("totp.regenerateConfirmTitle")} onClose={props.onClose}>
      <div className="space-y-4">
        <Hint>{t("totp.regenerateConfirmBody")}</Hint>
        <Field
          label={t("totp.regeneratePasswordLabel")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        {regenerate.error && <ErrorText>{regenerate.error}</ErrorText>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={props.onClose} disabled={regenerate.pending}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void regenerate.run()}
            disabled={regenerate.pending || !password}
          >
            {regenerate.pending ? t("common.saving") : t("totp.regenerateButton")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BackupCodesModal(props: { codes: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Modal title={t("totp.backupCodesTitle")} onClose={props.onClose}>
      <div className="space-y-4">
        <Hint>{t("totp.backupCodesIntro")}</Hint>
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-raised p-3">
          {props.codes.map((code) => (
            <code key={code} className="text-center text-xs text-text">
              {code}
            </code>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary select-none">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="rounded border-border"
          />
          {t("totp.backupCodesConfirm")}
        </label>
        <div className="flex items-center justify-end border-t border-border pt-3">
          <Button size="sm" variant="primary" onClick={props.onClose} disabled={!confirmed} className="gap-1.5">
            <CheckIcon size={13} /> {t("common.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
