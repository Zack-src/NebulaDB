<script lang="ts" module>
  export interface TableColumn {
    /** Header text; empty for a column of icon buttons. */
    label: string;
    align?: "left" | "right";
    /** Extra classes for the header cell only (a fixed width, `whitespace-nowrap`). */
    class?: string;
  }

  export type TableDensity = "comfortable" | "compact";

  /** Row and cell classes, so the rows a caller writes match the header this component draws. */
  export const TABLE_ROW = "border-b border-border last:border-b-0";
  export const TABLE_CELL: Record<TableDensity, string> = {
    comfortable: "px-3 py-2.5",
    compact: "px-2 py-1.5",
  };

  const HEADER_CELL: Record<TableDensity, string> = {
    comfortable: "px-3 py-2",
    compact: "px-2 py-1.5",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The one table of the app's pages: a bordered, horizontally scrollable shell
   * with a header row. The caller writes the `<tr>`s (use `TABLE_ROW` and
   * `TABLE_CELL[density]` so they line up with the header); anything that
   * needs more than rows — an editable grid, a data preview — is `DataGrid`
   * or its own markup, not this.
   */
  let {
    columns,
    children,
    label,
    density = "comfortable",
    minWidth,
    class: className = "",
  }: {
    columns: readonly TableColumn[];
    children: Snippet;
    /** Accessible name of the table. */
    label: string;
    density?: TableDensity;
    /** Below this width the shell scrolls instead of squeezing the columns. */
    minWidth?: number;
    class?: string;
  } = $props();
</script>

<div class={`overflow-x-auto rounded-md border border-border bg-surface ${className}`.trim()}>
  <table
    class="w-full border-collapse text-left text-label"
    style:min-width={minWidth ? `${minWidth}px` : undefined}
    aria-label={label}
  >
    <thead class="border-b border-border bg-surface-raised text-text-secondary">
      <tr>
        {#each columns as column, index (index)}
          <th
            class={`${HEADER_CELL[density]} font-semibold ${column.align === "right" ? "text-right" : ""} ${column.class ?? ""}`.trim()}
            >{column.label}</th
          >
        {/each}
      </tr>
    </thead>
    <tbody>
      {@render children()}
    </tbody>
  </table>
</div>
