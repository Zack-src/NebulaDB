<script lang="ts">
  import type { PersonalCredentialStatus } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchPersonalCredentials } from "@/services/connectionsApi";
  import PersonalAccountDialog from "./PersonalAccountDialog.svelte";

  /**
   * "Mon compte SQL": shown next to a connection that asks each user for
   * their own database account — in the warning colour until this user has
   * given one, since nothing they do on that database will work before.
   * Renders nothing for a connection used with one shared account.
   */
  let {
    connection,
    onChanged,
  }: {
    onChanged?: () => void;
    connection: { id: string; name: string; authMode: "shared" | "personal" };
  } = $props();

  const { t } = useTranslation();
  let status = $state.raw<PersonalCredentialStatus | null>(null);
  let open = $state(false);

  $effect(() => {
    const { id, authMode } = connection;
    status = null;
    if (authMode !== "personal") return;
    let stale = false;
    // A failure leaves the button out: the request that needs the account will say so itself.
    fetchPersonalCredentials(id).then(
      (answer) => {
        if (!stale) status = answer;
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  });
</script>

{#if status && connection.authMode === "personal"}
  <Button
    size="sm"
    variant={status.username ? "ghost" : "outline"}
    class={status.username ? "" : "!border-warning !text-warning"}
    onclick={() => (open = true)}
    data-tooltip={status.username ? t("personalAccount.tooltip") : t("personalAccount.missingTooltip")}
    data-tooltip-pos="bottom"
    data-testid="personal-account"
    data-account={status.username ?? ""}
  >
    <Icon icon={KeyIcon} size={13} />
    {status.username ?? t("personalAccount.missing")}
  </Button>
  {#if open}
    <PersonalAccountDialog
      connectionId={connection.id}
      connectionName={connection.name}
      {status}
      onChanged={(next) => {
        status = next;
        onChanged?.();
      }}
      onClose={() => (open = false)}
    />
  {/if}
{/if}
