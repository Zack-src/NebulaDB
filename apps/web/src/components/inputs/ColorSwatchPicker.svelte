<script lang="ts">
  import { anchoredPlacement, provisionalPopoverStyle } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon } from "@/components/icons/Icons";
  import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
  import { useDismissablePopover } from "@/hooks/dismissablePopover.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { HEX_RE, SWATCH_CELL_ACTIVE_CLASS, SWATCH_CELL_CLASS, SWATCH_GRID_CLASS } from "./colorSwatches";

  /**
   * Small circular swatch button that opens a preset-color popover (+ custom
   * hex) instead of the OS native color picker. Portaled to `document.body`
   * since every caller lives inside a canvas node — nodes clip overflow and
   * get CSS-transformed for pan/zoom, so an absolutely-positioned child
   * popover would either be clipped or scaled/misplaced with the canvas.
   *
   * `palette` is per-project (persisted in the doc's meta map, shared by every
   * table/zone/note picker in that project) rather than a fixed global list —
   * callers fall back to `DEFAULT_PALETTE` when the project hasn't customized
   * one yet. Right-click a swatch to remove it; the "+" cell adds whatever the
   * current value is.
   */
  let {
    value,
    onChange,
    palette,
    onPaletteChange,
    triggerClassName,
    tooltip,
  }: {
    value: string;
    onChange: (color: string) => void;
    palette: string[];
    onPaletteChange: (palette: string[]) => void;
    triggerClassName: string;
    tooltip?: string;
  } = $props();

  const { t } = useTranslation();
  let open = $state(false);
  // Re-seeded from the committed colour whenever it changes (writable derived).
  let hexDraft = $derived(value);
  let triggerRect = $state.raw<DOMRect | null>(null);
  let trigger: HTMLButtonElement | undefined = $state();
  let popover: HTMLDivElement | undefined = $state();

  useDismissablePopover(
    () => open,
    () => (open = false),
    () => [popover, trigger],
  );

  function toggle() {
    if (!open && trigger) triggerRect = trigger.getBoundingClientRect();
    open = !open;
  }

  function commitHex() {
    const next = hexDraft.trim();
    if (HEX_RE.test(next)) onChange(next);
    else hexDraft = value;
  }

  function removeFromPalette(event: MouseEvent, color: string) {
    event.preventDefault();
    onPaletteChange(palette.filter((c) => c !== color));
  }

  function addCurrentToPalette() {
    if (palette.some((c) => c.toLowerCase() === value.toLowerCase())) return;
    onPaletteChange([...palette, value]);
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class={`nodrag ${triggerClassName}`}
  style:background={value}
  onclick={(event) => {
    event.stopPropagation();
    toggle();
  }}
  ondblclick={(event) => event.stopPropagation()}
  data-tooltip={tooltip ?? "Color"}
  aria-label={tooltip ?? "Color"}
></button>
{#if open && triggerRect}
  <div
    use:portal
    use:anchoredPlacement={{ rect: triggerRect }}
    bind:this={popover}
    class="fixed z-[var(--z-popover)] animate-modal-in rounded-md border border-border-strong bg-surface-raised p-2.5 shadow-lg nodrag"
    style={provisionalPopoverStyle(triggerRect)}
  >
    <div class={SWATCH_GRID_CLASS}>
      {#each palette as c (c)}
        <button
          type="button"
          class={`${SWATCH_CELL_CLASS} ${c.toLowerCase() === value.toLowerCase() ? SWATCH_CELL_ACTIVE_CLASS : ""}`}
          style:background={c}
          onclick={() => {
            onChange(c);
            open = false;
          }}
          oncontextmenu={(event) => removeFromPalette(event, c)}
          data-tooltip={`${c} (right-click to remove)`}
          aria-label={c}
        ></button>
      {/each}
      <button
        type="button"
        class={`${SWATCH_CELL_CLASS} flex items-center justify-center border-dashed bg-surface text-text-muted hover:border-text-muted hover:text-text`}
        onclick={addCurrentToPalette}
        data-tooltip={t("palette.addColor")}
      >
        <Icon icon={PlusIcon} size={11} />
      </button>
    </div>
    <input
      class={`${INPUT_XS_CLASS} w-full font-mono`}
      bind:value={hexDraft}
      onblur={commitHex}
      onkeydown={(event) => {
        if (event.key === "Enter") commitHex();
        if (event.key === "Escape") hexDraft = value;
      }}
      spellcheck={false}
    />
  </div>
{/if}
