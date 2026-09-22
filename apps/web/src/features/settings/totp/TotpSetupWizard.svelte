<script lang="ts">
  import QRCode from "qrcode";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Field from "@/components/ui/Field.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { confirmTotpSetup, startTotpSetup, type TotpSetup } from "@/services/authApi";

  let { onClose, onEnabled }: { onClose: () => void; onEnabled: (backupCodes: string[]) => void } = $props();

  const { t } = useTranslation();
  let setup = $state.raw<TotpSetup | null>(null);
  let setupError = $state<string | null>(null);
  let qrDataUrl = $state<string | null>(null);
  let code = $state("");

  // One-shot on mount — re-runnable in principle (`POST /totp/setup` replaces
  // whatever secret was pending), but this component only ever mounts once
  // per "Enable 2FA" click, so a plain effect with an `active` guard is
  // enough; no retry button is wired to it.
  $effect(() => {
    let active = true;
    startTotpSetup()
      .then((result) => {
        if (active) setup = result;
      })
      .catch((err: unknown) => {
        if (active) setupError = err instanceof Error ? err.message : String(err);
      });
    return () => {
      active = false;
    };
  });

  $effect(() => {
    const current = setup;
    if (!current) return;
    let active = true;
    QRCode.toDataURL(current.otpauthUrl, { margin: 1, width: 200 })
      .then((url) => {
        if (active) qrDataUrl = url;
      })
      .catch(() => {
        // Non-fatal: the secret text field below still lets manual entry work.
      });
    return () => {
      active = false;
    };
  });

  const confirm = useAsyncAction(async () => {
    const result = await confirmTotpSetup(code);
    onEnabled(result.backupCodes);
  });
</script>

<Modal title={t("totp.setupTitle")} {onClose}>
  <div class="space-y-4">
    <Hint>{t("totp.setupIntro")}</Hint>

    {#if setupError}<ErrorText>{setupError}</ErrorText>{/if}

    {#if qrDataUrl}
      <img src={qrDataUrl} alt="" width={200} height={200} class="mx-auto rounded-lg border border-border" />
    {/if}

    {#if setup}
      <div>
        <span class="mb-1 block text-xs font-medium text-text-muted">{t("totp.secretLabel")}</span>
        <code class="block break-all rounded-md border border-border bg-surface-raised px-2.5 py-2 text-[11px] text-text">
          {setup.secret}
        </code>
      </div>
    {/if}

    <Field
      label={t("totp.codeLabel")}
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      placeholder={t("totp.codePlaceholder")}
      value={code}
      oninput={(event) => {
        code = event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 6);
        event.currentTarget.value = code;
      }}
      autofocus
    />

    {#if confirm.error}<ErrorText>{confirm.error}</ErrorText>{/if}

    <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={confirm.pending}>
        {t("totp.cancelSetup")}
      </Button>
      <Button
        size="sm"
        variant="primary"
        onclick={() => void confirm.run()}
        disabled={confirm.pending || code.length !== 6 || !setup}
      >
        {confirm.pending ? t("totp.verifying") : t("totp.verifyButton")}
      </Button>
    </div>
  </div>
</Modal>
