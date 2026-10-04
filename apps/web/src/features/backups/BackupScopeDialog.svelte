<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { startBackup } from "@/services/backupsApi";
  import { fetchTables } from "@/services/dbAdminApi";

  /**
   * A backup of some tables only, with a note saying why — the scope the API
   * always took and the "back up now" button never offered. Views are left
   * out: a backup holds rows, and a view has none of its own.
   */
  let {
    connectionId,
    onStarted,
    onClose,
  }: {
    connectionId: string;
    onStarted: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const tables = useAsyncResource(async () =>
    (await fetchTables(connectionId)).filter((table) => table.kind === "table").map((table) => table.name),
  );
  let chosen = $state.raw<ReadonlySet<string>>(new Set());
  let note = $state("");
  const names = $derived(tables.data ?? []);
  const toggle = (name: string, checked: boolean) => {
    const next = new Set(chosen);
    if (checked) next.add(name);
    else next.delete(name);
    chosen = next;
  };

  const start = useAsyncAction(async () => {
    await startBackup(connectionId, { tables: [...chosen], note: note.trim() || undefined });
    onStarted();
    onClose();
  });
</script>

<Modal title={t("backups.scope.title")} {onClose} dismissable={!start.pending}>
  <div class="flex flex-col gap-3 text-body-sm">
    <Hint>{t("backups.scope.hint")}</Hint>
    {#if tables.error}
      <ErrorText>{tables.error}</ErrorText>
    {:else if tables.loading}
      <p class="m-0 text-text-muted">{t("common.loading")}</p>
    {:else}
      <div class="flex items-center gap-2 text-xs">
        <Button size="xs" variant="ghost" onclick={() => (chosen = new Set(names))}>
          {t("backups.scope.all")}
        </Button>
        <Button size="xs" variant="ghost" onclick={() => (chosen = new Set())}>{t("backups.scope.none")}</Button>
        <span class="ml-auto text-text-muted">
          {t("backups.scope.count", { count: chosen.size, total: names.length })}
        </span>
      </div>
      <ul
        class="m-0 max-h-[280px] list-none overflow-y-auto rounded-sm border border-border p-2"
        aria-label={t("backups.scope.tables")}
      >
        {#each names as name (name)}
          <li class="py-0.5">
            <Checkbox checked={chosen.has(name)} onChange={(checked) => toggle(name, checked)}>
              <span class="font-mono text-xs">{name}</span>
            </Checkbox>
          </li>
        {/each}
      </ul>
    {/if}
    <input
      class={INPUT_SM_CLASS}
      maxlength={500}
      placeholder={t("backups.scope.note")}
      aria-label={t("backups.scope.note")}
      bind:value={note}
    />
    {#if start.error}<ErrorText>{start.error}</ErrorText>{/if}
    <div class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={start.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" disabled={chosen.size === 0 || start.pending} onclick={() => void start.run()}>
        {t("backups.scope.start", { count: chosen.size })}
      </Button>
    </div>
  </div>
</Modal>
