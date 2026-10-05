<script lang="ts">
  import type { PersonalCredentialStatus } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import PasswordInput from "@/components/ui/PasswordInput.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { assignDbCredentials } from "@/services/dbAccessApi";
  import { deletePersonalCredentials, savePersonalCredentials } from "@/services/connectionsApi";

  /**
   * One's own account on a database whose connection asks each user for
   * theirs. The server tries the account before keeping it, and never sends
   * the password back: the field is empty every time the dialog opens.
   */
  let {
    connectionId,
    connectionName,
    status,
    targetUserId,
    onChanged,
    onClose,
  }: {
    connectionId: string;
    connectionName: string;
    /** What the server last said about this user's account on the connection. */
    status: PersonalCredentialStatus;
    targetUserId?: string;
    onChanged: (status: PersonalCredentialStatus) => void;
    onClose: () => void;
  } = $props();

  const i18n = useTranslation();
  const { t } = i18n;
  // The name an instance administrator associated with this person comes first
  // when they have none yet; the password is always theirs to type.
  // svelte-ignore state_referenced_locally
  let username = $state(status.username ?? status.suggestedUsername ?? "");
  let password = $state("");

  const save = useAsyncAction(async () => {
    onChanged(
      await (targetUserId
        ? assignDbCredentials(targetUserId, connectionId, username.trim(), password)
        : savePersonalCredentials(connectionId, username.trim(), password)),
    );
    toast.success(t("personalAccount.saved", { connection: connectionName }));
    onClose();
  });
  const remove = useAsyncAction(async () => {
    onChanged(await deletePersonalCredentials(connectionId));
    toast.success(t("personalAccount.removed", { connection: connectionName }));
    onClose();
  });
  const pending = $derived(save.pending || remove.pending);
  const ready = $derived(username.trim().length > 0 && password.length > 0);
</script>

<Modal title={t("personalAccount.title", { connection: connectionName })} {onClose} narrow dismissable={!pending}>
  <form
    class="flex flex-col gap-3.5"
    onsubmit={(event) => {
      event.preventDefault();
      if (!pending && ready) void save.run();
    }}
  >
    <Hint>{t("personalAccount.intro")}</Hint>
    {#if !status.username && status.suggestedUsername}
      <p class="m-0 text-label text-text-muted" data-testid="personal-account-suggested">
        {t("personalAccount.suggested", { username: status.suggestedUsername })}
      </p>
    {/if}
    {#if status.username && status.updatedAt}
      <p class="m-0 text-label text-text-muted">
        {t("personalAccount.current", {
          username: status.username,
          date: formatDateTime(status.updatedAt, i18n.locale),
        })}
      </p>
    {/if}

    <label class="flex flex-col gap-1.5">
      <span class={LABEL_CLASS}>{t("personalAccount.username")}</span>
      <Input bind:value={username} autocomplete="off" disabled={pending} wrapperClassName="w-full" />
    </label>
    <label class="flex flex-col gap-1.5">
      <span class={LABEL_CLASS}>{t("personalAccount.password")}</span>
      <PasswordInput bind:value={password} disabled={pending} wrapperClassName="w-full" />
    </label>

    {#if save.error || remove.error}<ErrorText>{save.error ?? remove.error}</ErrorText>{/if}

    <div class="flex items-center gap-2 border-t border-border pt-3">
      {#if status.username && !targetUserId}
        <Button size="sm" variant="danger-ghost" onclick={() => void remove.run()} disabled={pending}>
          {t("personalAccount.remove")}
        </Button>
      {/if}
      <span class="flex-1"></span>
      <Button size="sm" variant="ghost" onclick={onClose} disabled={pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" type="submit" disabled={pending || !ready}>
        {t("personalAccount.save")}
      </Button>
    </div>
  </form>
</Modal>
