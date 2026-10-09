<script lang="ts">
  import type { BackupDestination } from "@nebuladb/shared";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { saveBackupDestination } from "@/services/backupsApi";

  /**
   * "Emplacement": the folder of the server this database's backups are written
   * to — a local one or a mounted network share. The server creates it and
   * writes a file there before keeping it, so a path that cannot work is
   * refused here rather than at the next backup.
   */
  let {
    connectionId,
    destination,
    onSaved,
  }: { connectionId: string; destination: BackupDestination; onSaved: (destination: BackupDestination) => void } = $props();

  const { t } = useTranslation();
  let draft = $state<string | null>(null);
  let saved = $state(false);
  const value = $derived(draft ?? destination.directory ?? "");
  const changed = $derived(value.trim() !== (destination.directory ?? ""));
  const save = useAsyncAction(async (directory: string | null) => {
    saved = false;
    onSaved(await saveBackupDestination(connectionId, directory));
    draft = null;
    saved = true;
  });
</script>

<div class="mt-3 rounded-md border border-border bg-surface p-3 text-xs" data-testid="backup-destination">
  <div class="mb-1 font-semibold text-text">{t("backups.destination.title")}</div>
  <Hint>{t("backups.destination.hint")}</Hint>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <input
      class={`${INPUT_SM_CLASS} min-w-[240px] flex-1 font-mono`}
      aria-label={t("backups.destination.label")}
      placeholder={t("backups.destination.placeholder", { directory: destination.defaultDirectory })}
      {value}
      disabled={save.pending}
      oninput={(event) => {
        draft = event.currentTarget.value;
        saved = false;
      }}
      onkeydown={(event) => {
        if (event.key === "Enter" && changed) void save.run(value.trim() || null);
      }}
    />
    <Button size="xs" variant="outline" disabled={!changed || save.pending} onclick={() => void save.run(value.trim() || null)}>
      {save.pending ? t("common.loading") : t("backups.destination.save")}
    </Button>
    {#if destination.directory}
      <Button size="xs" variant="ghost" disabled={save.pending} onclick={() => void save.run(null)}>
        {t("backups.destination.reset")}
      </Button>
    {/if}
  </div>
  {#if saved}<Hint>{t("backups.destination.saved")}</Hint>{/if}
  {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
</div>
