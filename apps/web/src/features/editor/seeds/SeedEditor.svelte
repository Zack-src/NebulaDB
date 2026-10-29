<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  const PAGE_SIZE = 100;

  /**
   * The rows of a small seed as a grid to edit in place: change a cell, add a row, delete one. An empty cell is
   * NULL. The rows go back to the dialog on every change, which writes them as the seed's CSV.
   */
  let {
    headers,
    rows,
    readOnly = false,
    onChange,
  }: {
    headers: string[];
    /** The data rows, header line excluded. */
    rows: (string | null)[][];
    readOnly?: boolean;
    onChange: (rows: (string | null)[][]) => void;
  } = $props();

  const { t } = useTranslation();
  let page = $state(0);
  const pageCount = $derived(Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const current = $derived(Math.min(page, pageCount - 1));
  const first = $derived(current * PAGE_SIZE);
  const visible = $derived(rows.slice(first, first + PAGE_SIZE));

  function setCell(row: number, column: number, value: string) {
    const next = rows.map((cells) => [...cells]);
    const line = next[row];
    if (!line) return;
    while (line.length < headers.length) line.push(null);
    line[column] = value === "" ? null : value;
    onChange(next);
  }

  function addRow() {
    onChange([...rows, headers.map(() => null)]);
    page = Math.floor(rows.length / PAGE_SIZE);
  }

  function deleteRow(row: number) {
    onChange(rows.filter((_, index) => index !== row));
  }
</script>

<div class="flex flex-col gap-2">
  <Hint>{t("seeds.edit.nullHint")}</Hint>
  {#if rows.length === 0}
    <p class="m-0 text-xs text-text-muted">{t("seeds.edit.noRows")}</p>
  {:else}
    <div class="max-h-[360px] overflow-auto rounded-sm border border-border">
      <table class="w-full border-collapse font-mono text-xs">
        <thead class="sticky top-0 z-10 bg-surface-raised">
          <tr>
            <th class="border-b border-border px-2 py-1 text-left text-text-muted">#</th>
            {#each headers as name, c (c)}
              <th class="border-b border-border px-2 py-1 text-left">{name}</th>
            {/each}
            <th class="border-b border-border"></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as cells, offset (first + offset)}
            {@const row = first + offset}
            <tr>
              <td class="px-2 py-0.5 text-text-muted">{row + 1}</td>
              {#each headers as name, c (c)}
                <td class="p-0">
                  <input
                    class="h-6 w-full min-w-[80px] border-0 bg-transparent px-2 text-text placeholder:text-text-muted focus:bg-surface-raised focus:outline focus:outline-1 focus:outline-primary"
                    value={cells[c] ?? ""}
                    placeholder="NULL"
                    readonly={readOnly}
                    aria-label={t("seeds.edit.cell", { row: row + 1, column: name })}
                    onchange={(event) => setCell(row, c, event.currentTarget.value)}
                  />
                </td>
              {/each}
              <td class="px-1">
                {#if !readOnly}
                  <button
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-danger"
                    aria-label={t("seeds.edit.deleteRow", { row: row + 1 })}
                    onclick={() => deleteRow(row)}
                  >
                    <Icon icon={TrashIcon} size={12} />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="flex items-center gap-2">
    {#if !readOnly}
      <Button size="sm" variant="outline" onclick={addRow}>
        <Icon icon={PlusIcon} size={13} />
        {t("seeds.edit.addRow")}
      </Button>
    {/if}
    <span class="flex-1"></span>
    {#if rows.length > PAGE_SIZE}
      <span class="text-xs text-text-muted">
        {t("seeds.edit.page", { from: first + 1, to: Math.min(rows.length, first + PAGE_SIZE), total: rows.length })}
      </span>
      <button
        type="button"
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-text-muted enabled:hover:bg-surface-hover disabled:opacity-30"
        disabled={current === 0}
        aria-label={t("seeds.edit.previous")}
        onclick={() => (page = current - 1)}
      >
        <Icon icon={ChevronLeftIcon} size={13} />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-text-muted enabled:hover:bg-surface-hover disabled:opacity-30"
        disabled={current >= pageCount - 1}
        aria-label={t("seeds.edit.next")}
        onclick={() => (page = current + 1)}
      >
        <Icon icon={ChevronLeftIcon} size={13} class="rotate-180" />
      </button>
    {/if}
  </div>
</div>
