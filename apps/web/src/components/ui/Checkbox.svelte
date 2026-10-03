<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon } from "@/components/icons/Icons";

  /**
   * A drawn checkbox over a real one. The native `<input>` stays in the DOM,
   * visually hidden, so the label association, Space to toggle, form
   * participation and the screen-reader role all come from the browser; only
   * the box is ours, which is what makes it look the same everywhere and lets
   * it show the indeterminate and invalid states.
   *
   * Pass the text as children (or `aria-label` for a bare box in a table row).
   */
  let {
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    invalid = false,
    onChange,
    hint,
    class: className = "",
    children,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    /** "Some but not all" — a parent box over a partially ticked list. Drawn as a dash, announced as mixed. */
    indeterminate?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    onChange?: (checked: boolean) => void;
    hint?: string;
    class?: string;
    children?: Snippet;
    "aria-label"?: string;
  } = $props();

  let input: HTMLInputElement | undefined = $state();

  // A DOM property with no attribute form — it has to be written on the node.
  $effect(() => {
    if (input) input.indeterminate = indeterminate;
  });
</script>

<label
  class={`group inline-flex items-start gap-2 text-body ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`.trim()}
>
  <input
    bind:this={input}
    bind:checked
    type="checkbox"
    class="peer sr-only"
    {disabled}
    aria-label={ariaLabel}
    aria-invalid={invalid || undefined}
    onchange={(event) => onChange?.(event.currentTarget.checked)}
  />
  <span
    class={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border text-white transition-colors duration-fast
      peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary
      ${
        checked || indeterminate
          ? "border-primary bg-primary"
          : `bg-surface ${invalid ? "border-danger" : "border-border-strong"} ${disabled ? "" : "group-hover:border-primary"}`
      }`}
  >
    {#if indeterminate}
      <span class="h-0.5 w-2 rounded-full bg-current"></span>
    {:else if checked}
      <Icon icon={CheckIcon} size={11} />
    {/if}
  </span>
  {#if children || hint}
    <span class="min-w-0">
      {#if children}<span class="block text-text">{@render children()}</span>{/if}
      {#if hint}<span class="block text-caption leading-normal text-text-muted">{hint}</span>{/if}
    </span>
  {/if}
</label>
