<script lang="ts" module>
  export type IndexOptions = { unique?: boolean; pk?: boolean; name?: string };
</script>

<script lang="ts">
  import type { Table, TableIndex } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { SettingsIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import TableSettingsPanel from "./TableSettingsPanel.svelte";

  /**
   * Table header's gear button — opens a popover to rename the table, pick its
   * header colour, and manage its indexes (including composite primary keys).
   * Only the trigger lives here; the panel is created when opened.
   */
  let {
    table,
    palette,
    onRename,
    onStyleChange,
    onAddIndex,
    onUpdateIndex,
    onDeleteIndex,
    triggerClassName,
  }: {
    table: Table;
    palette: string[];
    onRename: (name: string) => void;
    onStyleChange: (color: string | undefined, borderColor: string | undefined) => void;
    onAddIndex?: (fieldIds: string[], options: IndexOptions) => void;
    onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
    onDeleteIndex?: (indexId: string) => void;
    triggerClassName: string;
  } = $props();

  const { t } = useTranslation();
  let open = $state(false);
  let triggerRect = $state.raw<DOMRect | null>(null);
  let trigger: HTMLButtonElement | undefined = $state();

  function toggleOpen() {
    if (!open && trigger) {
      // Placement (and, crucially, the height cap) is derived from the
      // *table's* rect, not just the trigger button's — anchoring to the right
      // of the whole table so the popover sits beside it instead of dropping
      // down over it.
      const tableRect = trigger.closest(".table-node")?.getBoundingClientRect();
      triggerRect = tableRect ?? trigger.getBoundingClientRect();
    }
    open = !open;
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class={`nodrag ${triggerClassName}${open ? " has-open-popover" : ""}`}
  onclick={(event) => {
    event.stopPropagation();
    toggleOpen();
  }}
  ondblclick={(event) => event.stopPropagation()}
  data-tooltip={t("table.settingsTooltip")}
  aria-label={t("table.settingsTooltip")}
>
  <Icon icon={SettingsIcon} size={13} />
</button>
{#if open && triggerRect}
  <TableSettingsPanel
    {table}
    {palette}
    {onRename}
    {onStyleChange}
    {onAddIndex}
    {onUpdateIndex}
    {onDeleteIndex}
    {triggerRect}
    {trigger}
    onClose={() => (open = false)}
  />
{/if}
