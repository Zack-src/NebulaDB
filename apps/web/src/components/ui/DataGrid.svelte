<script lang="ts" module>
  /** Height of the sticky header row, in pixels. */
  const HEADER_HEIGHT = 30;
  /** One character of the 12px monospace face the cells are set in. */
  const CHAR_WIDTH = 7.25;
  /** A cell's horizontal padding (2 × 8px), plus the header's sort mark and its gap. */
  const CELL_CHROME = 34;
  /** Arrow keys on a resize handle move it by this much; with Shift, by `KEY_STEP_LARGE`. */
  const KEY_STEP = 16;
  const KEY_STEP_LARGE = 64;
  /** Used for the first paint, before the grid's own height has been measured. */
  const FALLBACK_VIEWPORT = 420;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    MAX_COLUMN_WIDTH,
    MIN_COLUMN_WIDTH,
    ariaSort,
    autoColumnWidth,
    clampWidth,
    formatCell,
    nextSort,
    resolveWidths,
    scrollTopForKey,
    sortedRowOrder,
    visibleRange,
    type GridSort,
  } from "./dataGrid";

  /**
   * A read-only table of values that stays usable with tens of thousands of
   * rows: only the rows in view are in the DOM (fixed row height, sticky
   * header), a click on a header sorts, a header's right edge resizes its
   * column.
   *
   *   <DataGrid columns={result.columns} rows={result.rows} aria-label="…" emptyLabel="…" />
   *
   * Sorting is done here, on the rows that were given — it never asks for
   * more. NULL is last in both directions; numbers, and text that reads as a
   * number, compare by value.
   *
   * Column widths start from the content of the first rows. Once the user
   * changes one they are the caller's: `bind:widths`, or `onWidthsCommit` at
   * the end of a drag or a key press — the moment to persist. The grid stores
   * nothing.
   *
   * ARIA `grid`, with the row and column counts and each rendered row's index,
   * since most rows are not in the DOM. The grid itself is a tab stop: arrows,
   * Page Up / Down, Home and End scroll by whole rows. Each header is a button
   * (sort); each resize handle a focusable `separator` — arrows resize (Shift:
   * larger steps), Home is the minimum, Enter or a double-click fits the
   * content.
   */
  let {
    columns,
    rows,
    sort = $bindable(null),
    widths = $bindable(),
    onWidthsCommit,
    rowHeight = 28,
    overscan = 8,
    maxHeight = 420,
    emptyLabel,
    nullLabel = "NULL",
    class: className = "",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    columns: readonly string[];
    /** Row-major; a cell is a string, a number, a boolean or `null`. */
    rows: readonly (readonly unknown[])[];
    sort?: GridSort | null;
    /** One width per column, in pixels. Left out, each column sizes itself to its content. */
    widths?: number[];
    /** Called once when a drag, a key press or a double-click has changed a width. */
    onWidthsCommit?: (widths: number[]) => void;
    /** Every row has this height, in pixels: it is what makes the scroll position computable. */
    rowHeight?: number;
    /** Rows kept in the DOM beyond each edge of the view. */
    overscan?: number;
    /** The grid scrolls past this height; `null` when the parent sets the height (`class`). */
    maxHeight?: number | null;
    /** Shown under the header when there are no rows. */
    emptyLabel?: string;
    /** How SQL NULL is written — the keyword, in every language. */
    nullLabel?: string;
    /** Layout only (height / flex). */
    class?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();

  const { t } = useTranslation();

  let viewport: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let clientHeight = $state(0);
  /** Index of the column being dragged, for the handle's pressed look. */
  let dragging = $state<number | null>(null);

  const activeSort = $derived(sort && sort.column >= 0 && sort.column < columns.length ? sort : null);
  /** Position on screen → index into `rows`. */
  const order = $derived(sortedRowOrder(rows, activeSort));

  const automaticWidths = $derived(
    columns.map((column, index) => autoColumnWidth(column, rows, index, { charWidth: CHAR_WIDTH, chrome: CELL_CHROME, nullLabel })),
  );
  const columnWidths = $derived(resolveWidths(automaticWidths, widths));
  const totalWidth = $derived(columnWidths.reduce((sum, width) => sum + width, 0));
  // Widths reach the cells through custom properties on the grid: resizing a
  // column then changes one declaration instead of one inline style per cell.
  const widthVariables = $derived(columnWidths.map((width, index) => `--dg-col-${index}:${width}px`).join(";"));

  const bodyHeight = $derived(Math.max(rowHeight, (clientHeight || maxHeight || FALLBACK_VIEWPORT) - HEADER_HEIGHT));
  const range = $derived(visibleRange({ scrollTop, viewportHeight: bodyHeight, rowHeight, rowCount: rows.length, overscan }));
  // Two numbers rather than the object: scrolling within a row changes neither, and nothing is re-rendered.
  const start = $derived(range.start);
  const end = $derived(range.end);
  const rendered = $derived(Array.from({ length: end - start }, (_, offset) => start + offset));

  function scrollTo(top: number) {
    scrollTop = top;
    if (viewport) viewport.scrollTop = top;
  }

  // New rows are a new result: it is read from the top.
  $effect(() => {
    void rows;
    untrack(() => scrollTo(0));
  });

  function toggleSort(column: number) {
    sort = nextSort(activeSort, column);
    scrollTo(0);
  }

  function handleGridKeyDown(event: KeyboardEvent) {
    // Keys pressed on a header button or a resize handle are theirs.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = scrollTopForKey(event.key, { scrollTop, viewportHeight: bodyHeight, rowHeight, rowCount: rows.length });
    if (target === null) return;
    event.preventDefault();
    scrollTo(target);
  }

  function setWidth(column: number, width: number) {
    widths = columnWidths.map((current, index) => (index === column ? clampWidth(width) : current));
  }

  function commitWidths() {
    if (widths) onWidthsCommit?.(widths);
  }

  function startResize(event: PointerEvent, column: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const origin = event.clientX;
    const startWidth = columnWidths[column];
    dragging = column;
    // Captured: the pointer leaves the handle on the first move.
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => setWidth(column, startWidth + moveEvent.clientX - origin);
    const stop = () => {
      dragging = null;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (columnWidths[column] !== startWidth) commitWidths();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function fitColumn(column: number) {
    setWidth(column, automaticWidths[column]);
    commitWidths();
  }

  function handleResizeKeyDown(event: KeyboardEvent, column: number) {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const current = columnWidths[column];
    let next: number;
    if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "Home") next = MIN_COLUMN_WIDTH;
    else if (event.key === "End") next = MAX_COLUMN_WIDTH;
    else if (event.key === "Enter") next = automaticWidths[column];
    else return;
    event.preventDefault();
    setWidth(column, next);
    commitWidths();
  }
</script>

<div class={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border ${className}`}>
  <div
    bind:this={viewport}
    bind:clientHeight
    role="grid"
    tabindex="0"
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledby}
    aria-rowcount={rows.length + 1}
    aria-colcount={columns.length}
    class="relative min-h-0 flex-auto overflow-auto font-mono text-label text-text outline-hidden
      focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
    style={`${widthVariables};${maxHeight === null ? "" : `max-height:${maxHeight}px`}`}
    onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
    onkeydown={handleGridKeyDown}
  >
    <div
      role="row"
      aria-rowindex="1"
      class="sticky top-0 z-[2] flex min-w-full border-b border-border bg-surface-raised"
      style={`width:${totalWidth}px;height:${HEADER_HEIGHT}px`}
    >
      {#each columns as column, c (c)}
        {@const sorted = ariaSort(activeSort, c)}
        <!-- Named explicitly: computed from its content, the name would end with the resize handle's label. -->
        <div
          role="columnheader"
          aria-colindex={c + 1}
          aria-sort={sorted}
          aria-label={column}
          class="relative shrink-0"
          style={`width:var(--dg-col-${c})`}
        >
          <button
            type="button"
            class="group/sort flex h-full w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-left font-mono text-label font-semibold
              text-text-secondary outline-hidden transition-colors duration-fast hover:text-text
              focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            title={column}
            onclick={() => toggleSort(c)}
          >
            <span class="min-w-0 truncate">{column}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 10 10"
              width="10"
              height="10"
              class={`shrink-0 fill-current transition-[opacity,transform] duration-fast ${sorted === "descending" ? "rotate-180" : ""}
                ${sorted === "none" ? "opacity-0 group-hover/sort:opacity-40 group-focus-visible/sort:opacity-40" : "text-primary"}`}
            >
              <path d="M5 2 9 8H1z" />
            </svg>
          </button>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            role="separator"
            tabindex="0"
            aria-orientation="vertical"
            aria-valuenow={columnWidths[c]}
            aria-valuemin={MIN_COLUMN_WIDTH}
            aria-valuemax={MAX_COLUMN_WIDTH}
            aria-label={t("ui.dataGrid.resizeColumn", { column })}
            class={`group/handle absolute inset-y-0 z-[1] w-[9px] cursor-col-resize touch-none select-none outline-hidden
              ${c === columns.length - 1 ? "right-0" : "-right-[4px]"}`}
            onpointerdown={(event) => startResize(event, c)}
            ondblclick={() => fitColumn(c)}
            onkeydown={(event) => handleResizeKeyDown(event, c)}
          >
            <!-- The 9px above are what can be grabbed; this is the line that is seen. -->
            <span
              class={`absolute inset-y-1.5 w-px bg-border-strong transition-colors duration-fast
                group-hover/handle:inset-y-0 group-hover/handle:bg-primary
                group-focus-visible/handle:inset-y-0 group-focus-visible/handle:w-0.5 group-focus-visible/handle:bg-primary
                ${c === columns.length - 1 ? "right-0" : "right-[4px]"} ${dragging === c ? "!inset-y-0 !bg-primary" : ""}`}
            ></span>
          </div>
        </div>
      {/each}
    </div>

    <div role="rowgroup" class="relative min-w-full" style={`width:${totalWidth}px;height:${rows.length * rowHeight}px`}>
      {#each rendered as position (position)}
        {@const row = rows[order[position]]}
        <div
          role="row"
          aria-rowindex={position + 2}
          class={`absolute left-0 flex w-full hover:bg-surface-hover ${position === rows.length - 1 ? "" : "border-b border-border/60"}`}
          style={`top:${position * rowHeight}px;height:${rowHeight}px;line-height:${rowHeight - 1}px`}
        >
          {#each columns as _, c (c)}
            {@const text = formatCell(row?.[c])}
            <div
              role="gridcell"
              aria-colindex={c + 1}
              class="shrink-0 truncate px-2 whitespace-nowrap"
              style={`width:var(--dg-col-${c})`}
              title={text ?? undefined}
            >
              {#if text === null}<span class="text-text-muted italic">{nullLabel}</span>{:else}{text}{/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
  {#if rows.length === 0 && emptyLabel}
    <p class="m-0 px-3 py-4 text-center font-sans text-label text-text-muted">{emptyLabel}</p>
  {/if}
</div>
