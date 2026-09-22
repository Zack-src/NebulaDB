<script lang="ts">
  import type { Table, TableIndex } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon, TrashIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    index,
    table,
    onUpdate,
    onDelete,
  }: {
    index: TableIndex;
    table: Table;
    onUpdate?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
    onDelete?: (indexId: string) => void;
  } = $props();

  const { t } = useTranslation();
  const columnNames = $derived(
    index.fieldIds.map((id) => table.fields.find((field) => field.id === id)?.name ?? "?").join(", "),
  );
</script>

<div class="flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2 py-1.5">
  <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text" data-tooltip={columnNames}>
    {columnNames}
  </span>
  {#if index.pk}
    <Badge tone="warning" class="shrink-0 inline-flex items-center gap-0.5">
      <Icon icon={KeyIcon} size={9} /> PK
    </Badge>
  {/if}
  <button
    type="button"
    class={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase ${
      index.unique ? "bg-primary-light text-primary" : "text-text-muted hover:text-text"
    }`}
    onclick={() => onUpdate?.(index.id, { unique: !index.unique })}
    data-tooltip={t("table.index.toggleUnique")}
  >
    {t("table.index.uniqueShort")}
  </button>
  <Button variant="danger-ghost" size="icon" onclick={() => onDelete?.(index.id)} data-tooltip={t("table.index.delete")}>
    <Icon icon={TrashIcon} size={12} />
  </Button>
</div>
