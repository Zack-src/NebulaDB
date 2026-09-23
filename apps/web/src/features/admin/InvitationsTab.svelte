<script lang="ts" module>
  import type { InvitationSummary, TranslationKeyOf } from "@/types";

  const STATUS_TONE = { pending: "warning", accepted: "success", expired: "danger" } as const;
  const STATUS_LABEL_KEY = {
    pending: "admin.invitations.status.pending",
    accepted: "admin.invitations.status.accepted",
    expired: "admin.invitations.status.expired",
  } as const satisfies Record<InvitationSummary["status"], TranslationKeyOf>;

  const COPIED_FEEDBACK_MS = 1500;
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { LinkIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { CHECKBOX_CLASS, INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { copyText } from "@/utils/clipboard";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { createInvitation, fetchInvitations, revokeInvitation } from "@/services/invitationsApi";

  const { t } = useTranslation();
  const invitations = useAsyncResource(fetchInvitations);
  let email = $state("");
  let invitingAsAdmin = $state(false);
  let copiedToken = $state<string | null>(null);
  let lastInvite = $state<{ email: string; emailSent: boolean } | null>(null);

  const invite = useAsyncAction(async () => {
    lastInvite = null;
    const created = await createInvitation(email.trim(), invitingAsAdmin);
    lastInvite = { email: created.email, emailSent: created.emailSent };
    email = "";
    invitingAsAdmin = false;
    invitations.reload();
  });

  const revoke = useAsyncAction(async (token: string) => {
    await revokeInvitation(token);
    invitations.reload();
  });

  function handleInvite() {
    if (email.trim()) void invite.run();
  }

  function copyInviteLink(invitation: InvitationSummary) {
    void copyText(`${location.origin}/invite/${invitation.token}`).then((ok) => {
      if (!ok) return;
      copiedToken = invitation.token;
      // Only clears its own feedback: copying a second link before the first
      // timer fires must not blank the newer confirmation.
      setTimeout(() => {
        if (copiedToken === invitation.token) copiedToken = null;
      }, COPIED_FEEDBACK_MS);
    });
  }

  const rows = $derived(invitations.data ?? []);
  const error = $derived(invitations.error ?? invite.error ?? revoke.error);
</script>

<div>
  <div class="mb-7 flex max-w-[420px] items-center gap-2">
    <input
      class={`${INPUT_CLASS} flex-1`}
      placeholder={t("admin.invitations.emailPlaceholder")}
      bind:value={email}
      onkeydown={(event) => event.key === "Enter" && handleInvite()}
    />
    <label class="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-text-muted">
      <input type="checkbox" class={CHECKBOX_CLASS} bind:checked={invitingAsAdmin} />
      {t("common.admin")}
    </label>
    <Button variant="primary" onclick={handleInvite} disabled={invite.pending || !email.trim()}>
      <Icon icon={PlusIcon} size={14} />
      {t("admin.invitations.invite")}
    </Button>
  </div>
  {#if lastInvite}
    <p class="-mt-4 mb-5 text-xs text-text-muted" role="status">
      {lastInvite.emailSent
        ? t("admin.invitations.emailSent", { email: lastInvite.email })
        : t("admin.invitations.emailNotSent", { email: lastInvite.email })}
    </p>
  {/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if rows.length === 0}
    <EmptyState>{invitations.loading ? t("common.loading") : t("admin.invitations.empty")}</EmptyState>
  {:else}
    <List>
      {#each rows as invitation (invitation.token)}
        <ListRow>
          <ListMain>
            <span>{invitation.email}</span>
            {#if invitation.isAdmin}<Badge tone="admin">{t("common.admin")}</Badge>{/if}
          </ListMain>
          <Badge tone={STATUS_TONE[invitation.status]}>{t(STATUS_LABEL_KEY[invitation.status])}</Badge>
          {#if invitation.status === "pending"}
            <Button size="sm" onclick={() => copyInviteLink(invitation)}>
              <Icon icon={LinkIcon} size={12} />
              {copiedToken === invitation.token ? t("common.copied") : t("admin.invitations.copyLink")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              data-tooltip={t("admin.invitations.revoke")}
              onclick={() => void revoke.run(invitation.token)}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          {/if}
        </ListRow>
      {/each}
    </List>
  {/if}
</div>
