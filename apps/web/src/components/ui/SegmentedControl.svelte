<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";

  export interface SegmentOption<T> {
    value: T;
    label: string;
    icon?: IconDefinition;
    tooltip?: string;
    disabled?: boolean;
  }

  export type SegmentedSize = "md" | "sm" | "xs";

  const SIZE: Record<SegmentedSize, string> = {
    md: "h-7 px-3 text-body-sm",
    sm: "h-6 px-2 text-label",
    xs: "h-5 px-1.5 text-caption",
  };
</script>

<script lang="ts" generics="T">
  import Icon from "@/components/icons/Icon.svelte";

  /**
   * Two to five mutually exclusive choices shown side by side — a mode switch
   * or a short setting. Past that, or when labels are long, use `Select`.
   *
   * A radio group as far as assistive tech is concerned: one tab stop, arrow
   * keys move *and* select (there is no separate "confirm" step in a control
   * whose effect is immediate), Home / End jump to the ends.
   */
  let {
    value = $bindable(),
    options,
    onChange,
    size = "md",
    class: className = "",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    value?: T;
    options: readonly SegmentOption<T>[];
    onChange?: (value: T) => void;
    size?: SegmentedSize;
    class?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();

  let group: HTMLDivElement | undefined = $state();

  const selectedIndex = $derived(options.findIndex((option) => option.value === value));
  /** The one segment in the tab order: the selected one, or the first usable one when nothing is selected. */
  const tabStop = $derived(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));

  function select(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    value = option.value;
    onChange?.(option.value);
  }

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    let next = -1;
    if (step !== 0) {
      // Wraps, skipping disabled segments.
      for (let offset = 1; offset <= options.length; offset++) {
        const candidate = (index + step * offset + options.length * offset) % options.length;
        if (!options[candidate].disabled) {
          next = candidate;
          break;
        }
      }
    } else if (event.key === "Home") next = options.findIndex((option) => !option.disabled);
    else if (event.key === "End") next = options.map((option) => !option.disabled).lastIndexOf(true);
    if (next === -1) return;
    event.preventDefault();
    select(next);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div
  bind:this={group}
  role="radiogroup"
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  class={`inline-flex shrink-0 gap-0.5 rounded-md border border-border bg-surface p-0.5 ${className}`.trim()}
>
  {#each options as option, index (index)}
    {@const on = index === selectedIndex}
    <button
      type="button"
      role="radio"
      aria-checked={on}
      tabindex={index === tabStop ? 0 : -1}
      disabled={option.disabled}
      data-tooltip={option.tooltip}
      class={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors duration-fast
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary
        disabled:cursor-not-allowed disabled:opacity-45
        ${SIZE[size]} ${on ? "bg-primary text-white shadow-xs" : "text-text-secondary enabled:hover:bg-surface-hover enabled:hover:text-text"}`}
      onclick={() => select(index)}
      onkeydown={(event) => handleKeyDown(event, index)}
    >
      {#if option.icon}<Icon icon={option.icon} size={13} />{/if}
      {option.label}
    </button>
  {/each}
</div>
