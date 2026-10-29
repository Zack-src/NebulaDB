<script lang="ts">
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { diffRows, foldUnchanged, type DiffCell, type DiffRow } from "./lineDiff";

  /**
   * The DBML of a revision next to the DBML of the schema now, side by side as a code review shows it:
   * the changed lines marked (added, removed, modified, with the changed part of a modified line
   * highlighted), the rest folded away — or, on request, both texts in full.
   * The new text is on the left, the old one on the right.
   */
  let {
    before,
    after,
    beforeLabel,
    afterLabel,
  }: {
    /** The old text (the revision), shown on the right. */
    before: string;
    /** The new text (the schema now), shown on the left. */
    after: string;
    beforeLabel: string;
    afterLabel: string;
  } = $props();

  const { t } = useTranslation();
  let mode = $state<"diff" | "full">("diff");

  const rows = $derived(diffRows(before, after));
  const changed = $derived(rows.some((row) => row.kind !== "same"));
  const items = $derived(mode === "full" ? rows : foldUnchanged(rows));

  const SIDE = "flex min-w-0 flex-1";
  const NUMBER = "w-10 shrink-0 select-none px-1.5 text-right text-text-muted";
  const CODE = "min-w-0 flex-1 whitespace-pre-wrap break-all pl-1.5 pr-2";

  function tint(row: DiffRow, side: "before" | "after"): string {
    const cell = row[side];
    if (!cell) return "bg-surface-hover/60";
    if (row.kind === "same") return "";
    return side === "before" ? "bg-danger-light" : "bg-success-light";
  }

  /** A line cut into what comes before the changed part, the part, and what follows. */
  function parts(cell: DiffCell): [string, string, string] {
    if (!cell.mark || cell.mark.from >= cell.mark.to) return [cell.text, "", ""];
    return [cell.text.slice(0, cell.mark.from), cell.text.slice(cell.mark.from, cell.mark.to), cell.text.slice(cell.mark.to)];
  }
</script>

{#snippet side(row: DiffRow, which: "before" | "after")}
  {@const cell = row[which]}
  <div class={`${SIDE} ${tint(row, which)}`}>
    <span class={NUMBER}>{cell?.line ?? ""}</span>
    {#if cell}
      {@const [head, marked, tail] = parts(cell)}
      <span class={CODE}
        >{head}{#if marked}<mark class={`rounded-xs text-inherit ${which === "before" ? "bg-danger/30" : "bg-success/30"}`}
            >{marked}</mark
          >{/if}{tail}</span
      >
    {:else}
      <span class={CODE}></span>
    {/if}
  </div>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-1.5">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <SegmentedControl
      size="sm"
      bind:value={mode}
      aria-label={t("history.dbmlDiff.mode")}
      options={[
        { value: "diff", label: t("history.dbmlDiff.modeDiff") },
        { value: "full", label: t("history.dbmlDiff.modeFull") },
      ]}
    />
    <span class="flex items-center gap-3 text-caption text-text-muted">
      <span class="flex items-center gap-1"><i class="inline-block h-2.5 w-2.5 rounded-xs bg-success/40"></i>{t("history.dbmlDiff.added")}</span>
      <span class="flex items-center gap-1"><i class="inline-block h-2.5 w-2.5 rounded-xs bg-danger/40"></i>{t("history.dbmlDiff.removed")}</span>
    </span>
  </div>
  <div
    class="min-h-[180px] flex-1 overflow-auto rounded-sm border border-border bg-[var(--color-bg-canvas)] font-mono text-xs leading-5"
    data-testid="dbml-diff"
  >
    <div class="sticky top-0 z-10 grid grid-cols-2 border-b border-border bg-surface text-caption font-semibold text-text-muted">
      <div class="truncate px-2 py-1">{afterLabel}</div>
      <div class="truncate border-l border-border px-2 py-1">{beforeLabel}</div>
    </div>
    {#if mode === "diff" && !changed}
      <p class="m-0 p-3 font-sans text-text-muted">{t("history.dbmlDiff.noChanges")}</p>
    {:else}
      {#each items as item, index (index)}
        {#if item.kind === "gap"}
          <div class="border-y border-border bg-surface-hover/60 px-2 py-0.5 text-center font-sans text-caption text-text-muted">
            {t("history.dbmlDiff.hidden", { count: item.hidden })}
          </div>
        {:else}
          <div class="grid grid-cols-2" data-kind={item.kind}>
            {@render side(item, "after")}
            <div class="flex border-l border-border">{@render side(item, "before")}</div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
