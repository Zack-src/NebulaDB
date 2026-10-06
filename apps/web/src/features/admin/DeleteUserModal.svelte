<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { deleteUser } from "@/services/usersApi";
  import type { UserSummary } from "@/types";

    /**
     * Deleting an account is irreversible, and the projects the person owns have to go somewhere:
     * the server default leaves them ownerless, with no route to reassign, so the transfer choice
     * is put before the decision. Typing the email is deliberate friction.
     */
  let {
    targetUser,
    users,
    onClose,
    onDeleted,
  }: { targetUser: UserSummary; users: UserSummary[]; onClose: () => void; onDeleted: () => void } = $props();

  const { t } = useTranslation();
  let confirmation = $state("");
  let transferTo = $state("");

  const transferCandidates = $derived(users.filter((user) => user.id !== targetUser.id && !user.disabledAt));
  const confirmed = $derived(confirmation.trim().toLowerCase() === targetUser.email.toLowerCase());

  const remove = useAsyncAction(async () => {
    await deleteUser(targetUser.id, transferTo || undefined);
    onDeleted();
  });
</script>

<Modal title={t("admin.deleteUser.title", { email: targetUser.email })} {onClose}>
  <Hint>{t("admin.deleteUser.consequences")}</Hint>

  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label id="delete-user-transfer" class="mt-4 block text-xs font-semibold text-text-secondary">
    {t("admin.deleteUser.ownedProjects")}
  </label>
  <Select
    class="mt-1 w-full"
    aria-labelledby="delete-user-transfer"
    bind:value={transferTo}
    options={[
      { value: "", label: t("admin.deleteUser.leaveOwnerless") },
      ...transferCandidates.map((user) => ({
        value: user.id,
        label: t("admin.deleteUser.transferTo", { name: user.displayName, email: user.email }),
      })),
    ]}
  />

  <label class="mt-4 block text-xs font-semibold text-text-secondary">
    {t("admin.deleteUser.typeToConfirmPrefix")} <span class="font-mono text-text">{targetUser.email}</span>
    {t("admin.deleteUser.typeToConfirmSuffix")}
    <input class={`${INPUT_CLASS} mt-1 w-full`} bind:value={confirmation} use:autofocus autocomplete="off" />
  </label>

  <Button variant="danger" class="mt-4" onclick={() => void remove.run()} disabled={remove.pending || !confirmed}>
    {remove.pending ? t("common.deleting") : t("admin.deleteUser.confirm")}
  </Button>
  {#if remove.error}<ErrorText>{remove.error}</ErrorText>{/if}
</Modal>
