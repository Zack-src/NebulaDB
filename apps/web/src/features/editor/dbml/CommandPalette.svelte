<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { PaletteItem } from "./DbmlEditor/types";
  import { fuzzyScore } from "./fuzzyScore";

  let { items, placeholder, onClose }: { items: PaletteItem[]; placeholder: string; onClose: () => void } = $props();

  const { t } = useTranslation();
  let query = $state("");
  let index = $state(0);
  let list: HTMLDivElement | undefined = $state();

  const filtered = $derived(
    items
      .map((item) => ({ item, s: fuzzyScore(query, `${item.label} ${item.detail ?? ""}`) }))
      .filter((r): r is { item: PaletteItem; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.item)
      .slice(0, 200),
  );

  $effect(() => {
    const el = list?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  });

  function commit(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute inset-0 z-40 flex justify-center bg-black/40 pt-10"
  onmousedown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div class="flex max-h-[70%] w-[92%] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
    <input
      use:autofocus
      value={query}
      {placeholder}
      oninput={(event) => {
        query = event.currentTarget.value;
        index = 0;
      }}
      onkeydown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          index = Math.min(filtered.length - 1, index + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          index = Math.max(0, index - 1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          commit(filtered[index]);
        }
        event.stopPropagation();
      }}
      class="w-full border-b border-border bg-transparent px-3 py-2.5 text-body text-text outline-hidden placeholder:text-text-muted"
    />
    <div bind:this={list} class="min-h-0 flex-1 overflow-y-auto py-1">
      {#if filtered.length === 0}
        <div class="px-3 py-2 text-label text-text-muted">{t("commandPalette.noMatch")}</div>
      {/if}
      {#each filtered as item, i (item.id)}
        <button
          data-idx={i}
          type="button"
          onmouseenter={() => (index = i)}
          onclick={() => commit(item)}
          class={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm ${
            i === index ? "bg-primary text-white" : "text-text hover:bg-surface-hover"
          }`}
        >
          {#if item.kind}
            <span
              class={`shrink-0 rounded px-1 py-px text-micro uppercase tracking-wide ${
                i === index ? "bg-white/20 text-white" : "bg-border text-text-muted"
              }`}
            >
              {item.kind}
            </span>
          {/if}
          <span class="truncate">{item.label}</span>
          {#if item.detail}
            <span class={`truncate text-caption ${i === index ? "text-white/70" : "text-text-muted"}`}>{item.detail}</span>
          {/if}
          {#if item.hint}
            <span class={`ml-auto shrink-0 text-caption ${i === index ? "text-white/70" : "text-text-muted"}`}>{item.hint}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
</div>
