<script lang="ts" module>
  export interface RadioOption<T> {
    value: T;
    label: string;
    hint?: string;
    disabled?: boolean;
  }
</script>

<script lang="ts" generics="T">
  /**
   * One choice among a few, all visible at once — use `Select` past five or six
   * options, `SegmentedControl` when the labels are a word each.
   *
   * Same construction as `Checkbox`: real radios sharing a `name`, visually
   * hidden, so the browser provides the arrow-key roving and the group
   * semantics, and only the dot is drawn here.
   */
  let {
    value = $bindable(),
    options,
    onChange,
    orientation = "vertical",
    disabled = false,
    class: className = "",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    value?: T;
    options: readonly RadioOption<T>[];
    onChange?: (value: T) => void;
    orientation?: "vertical" | "horizontal";
    disabled?: boolean;
    class?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();

  const name = $props.id();
</script>

<div
  role="radiogroup"
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  class={`flex ${orientation === "vertical" ? "flex-col gap-2" : "flex-wrap gap-x-4 gap-y-2"} ${className}`.trim()}
>
  {#each options as option, index (index)}
    {@const off = disabled || option.disabled}
    {@const on = option.value === value}
    <label class={`group inline-flex items-start gap-2 text-body ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="radio"
        class="peer sr-only"
        {name}
        checked={on}
        disabled={off}
        onchange={() => {
          value = option.value;
          onChange?.(option.value);
        }}
      />
      <span
        class={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-surface transition-colors duration-fast
          peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary
          ${on ? "border-primary" : `border-border-strong ${off ? "" : "group-hover:border-primary"}`}`}
      >
        {#if on}<span class="h-2 w-2 rounded-full bg-primary"></span>{/if}
      </span>
      <span class="min-w-0">
        <span class="block text-text">{option.label}</span>
        {#if option.hint}<span class="block text-caption leading-normal text-text-muted">{option.hint}</span>{/if}
      </span>
    </label>
  {/each}
</div>
