<script lang="ts">
  import type { TableLock } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { unlockTable } from "@/services/tableLocksApi";
  import { canOverrideLock, type TableLocksView } from "./tableLocks.svelte";

  /**
   * Every lock of the project in one place: which tables are frozen, at what
   * level, by whom and why. Anyone who sees the project reads it; those who
   * may manage a given lock can change or lift it from here.
   */
  let {
    projectId,
    view,
    tableNames,
    onOpenTable,
    onManage,
    onChanged,
    onClose,
  }: {
    projectId: string;
    view: TableLocksView;
    /** Tables the schema has now, by id — a lock whose table is gone is listed as such. */
    tableNames: ReadonlyMap<string, string>;
    onOpenTable: (tableName: string) => void;
    /** Opens the lock's own dialog (level, authority, reason). */
    onManage: (tableId: string) => void;
    onChanged: () => void;
    onClose: () => void;
  } = $props();

  const i18n = useTranslation();
  const { t } = i18n;
  const locks = $derived(
    [...view.byTable.values()].sort((a, b) =>
      (tableNames.get(a.tableId) ?? a.tableName).localeCompare(tableNames.get(b.tableId) ?? b.tableName),
    ),
  );
  const nameOf = (lock: TableLock) => tableNames.get(lock.tableId) ?? lock.tableName;

  const unlock = useAsyncAction(async (lock: TableLock) => {
    await unlockTable(projectId, lock.tableId);
    toast.success(t("locks.unlockedToast", { table: nameOf(lock) }));
    onChanged();
  });
</script>

<Modal title={t("locks.list.title")} {onClose} wide>
  <div class="flex flex-col gap-3 text-body-sm">
    <Hint>{t("locks.dialogIntro")}</Hint>
    {#if locks.length === 0}
      <EmptyState>{t("locks.list.empty")}</EmptyState>
    {:else}
      <ul class="m-0 flex list-none flex-col p-0" aria-label={t("locks.list.title")}>
        {#each locks as lock (lock.tableId)}
          {@const exists = tableNames.has(lock.tableId)}
          {@const manageable = canOverrideLock(view.canManage, lock)}
          <li
            class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0"
            data-table={nameOf(lock)}
          >
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2">
                <span class="font-mono font-semibold text-text">{nameOf(lock)}</span>
                <Badge tone={lock.level === "full" ? "warning" : "muted"}>
                  {lock.level === "full" ? t("locks.levelFull") : t("locks.levelStructure")}
                </Badge>
                {#if lock.authority === "instance"}<Badge tone="admin">{t("locks.list.instance")}</Badge>{/if}
                {#if !exists}<Badge tone="danger">{t("locks.list.tableGone")}</Badge>{/if}
              </span>
              <span class="block text-xs text-text-muted">
                {t("locks.lockedBy", {
                  name: lock.lockedByName ?? "—",
                  date: formatDateTime(lock.lockedAt, i18n.locale),
                })}
                {#if lock.reason}<span class="text-text-secondary"> {lock.reason}</span>{/if}
              </span>
            </span>
            {#if exists}
              <Button size="xs" variant="ghost" onclick={() => onOpenTable(nameOf(lock))}>
                {t("locks.list.show")}
              </Button>
            {/if}
            {#if manageable}
              {#if exists}
                <Button size="xs" variant="outline" disabled={unlock.pending} onclick={() => onManage(lock.tableId)}>
                  {t("locks.list.edit")}
                </Button>
              {/if}
              <Button size="xs" variant="outline" disabled={unlock.pending} onclick={() => void unlock.run(lock)}>
                {t("locks.unlock")}
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if unlock.error}<ErrorText>{unlock.error}</ErrorText>{/if}
  </div>
</Modal>
