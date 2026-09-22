<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { deleteUser } from "@/services/usersApi";
  import type { UserSummary } from "@/types";

  /**
   * Deleting an account is the one irreversible action in the admin console, and
   * it has a consequence that isn't obvious from the button: projects the person
   * owns have to go somewhere. The server's default is to leave them ownerless —
   * readable by everyone, manageable only by global admins — and there is no
   * route to re-assign an owner afterwards, so this dialog puts the transfer
   * choice in front of the decision rather than after it.
   *
   * Typing the email to confirm is deliberate friction: the list rows are one
   * click apart and the two neighbouring actions (reset password, disable) are
   * both recoverable.
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

  <label class="mt-4 block text-xs font-semibold text-text-secondary">
    {t("admin.deleteUser.ownedProjects")}
    <select class={`${SELECT_CLASS} mt-1 w-full`} bind:value={transferTo}>
      <option value="">{t("admin.deleteUser.leaveOwnerless")}</option>
      {#each transferCandidates as user (user.id)}
        <option value={user.id}>{t("admin.deleteUser.transferTo", { name: user.displayName, email: user.email })}</option>
      {/each}
    </select>
  </label>

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
