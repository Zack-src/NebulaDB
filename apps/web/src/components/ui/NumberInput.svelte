<script lang="ts" module>
  import {
    INPUT_CLASS,
    INPUT_INVALID_CLASS,
    INPUT_SM_CLASS,
    INPUT_XS_CLASS,
  } from "@/components/ui/inputStyles";

  export type NumberInputSize = "md" | "sm" | "xs";

  const SIZE_CLASS: Record<NumberInputSize, string> = { md: INPUT_CLASS, sm: INPUT_SM_CLASS, xs: INPUT_XS_CLASS };

  /** The browser's own spin buttons are replaced by the stepper drawn below. */
  const NO_NATIVE_SPINNER =
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * A numeric field with its own stepper and an optional unit.
   *
   * `value` is `null` while the field is empty or holds something that is not a
   * number — never `NaN`, and never silently `0`. Bounds are enforced when the
   * field loses focus and by the stepper, not on every keystroke: clamping
   * "1" to a minimum of 10 while the user is still typing "15" makes the field
   * impossible to use.
   */
  let {
    value = $bindable(null),
    onChange,
    min,
    max,
    step = 1,
    unit,
    inputSize = "md",
    invalid = false,
    disabled = false,
    placeholder,
    id,
    class: className = "",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    value?: number | null;
    onChange?: (value: number | null) => void;
    min?: number;
    max?: number;
    step?: number;
    /** Shown inside the field, before the stepper ("ms", "px", "%"). */
    unit?: string;
    inputSize?: NumberInputSize;
    invalid?: boolean;
    disabled?: boolean;
    placeholder?: string;
    id?: string;
    /** Layout only (width / flex), applied to the wrapper. */
    class?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();

  const { t } = useTranslation();

  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));

  function commit(next: number | null) {
    if (next === value) return;
    value = next;
    onChange?.(next);
  }

  function nudge(direction: 1 | -1) {
    // From an empty field the first press lands on the nearest bound (or 0),
    // not on `step` away from nothing.
    const base = value ?? clamp(0) - direction * step;
    // Rounded to the step's own precision: 0.1 + 0.2 must read 0.3.
    const decimals = (String(step).split(".")[1] ?? "").length;
    commit(clamp(Number((base + direction * step).toFixed(decimals))));
  }

  const STEPPER =
    "flex h-1/2 w-5 items-center justify-center text-text-muted enabled:hover:bg-surface-hover enabled:hover:text-text disabled:cursor-not-allowed disabled:opacity-40";
</script>

<div class={`relative inline-flex items-center ${className}`.trim()}>
  <input
    type="number"
    {id}
    {min}
    {max}
    {step}
    {disabled}
    {placeholder}
    value={value ?? ""}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledby}
    aria-invalid={invalid || undefined}
    class={`w-full tabular-nums ${SIZE_CLASS[inputSize]} ${NO_NATIVE_SPINNER} ${invalid ? INPUT_INVALID_CLASS : ""} ${unit ? "pr-14" : "pr-7"}`}
    oninput={(event) => {
      const parsed = event.currentTarget.valueAsNumber;
      commit(Number.isNaN(parsed) ? null : parsed);
    }}
    onblur={() => {
      if (value !== null) commit(clamp(value));
    }}
  />
  {#if unit}
    <span class="pointer-events-none absolute right-7 text-label text-text-muted">{unit}</span>
  {/if}
  <!-- Out of the tab order: ArrowUp / ArrowDown in the field already step it. -->
  <span class="absolute inset-y-px right-px flex w-5 flex-col overflow-hidden rounded-r-[5px] border-l border-border">
    <button
      type="button"
      tabindex={-1}
      class={STEPPER}
      disabled={disabled || (max !== undefined && value !== null && value >= max)}
      aria-label={t("ui.number.increment")}
      onclick={() => nudge(1)}
    >
      <Icon icon={ChevronRightIcon} size={11} class="-rotate-90" />
    </button>
    <button
      type="button"
      tabindex={-1}
      class={`${STEPPER} border-t border-border`}
      disabled={disabled || (min !== undefined && value !== null && value <= min)}
      aria-label={t("ui.number.decrement")}
      onclick={() => nudge(-1)}
    >
      <Icon icon={ChevronRightIcon} size={11} class="rotate-90" />
    </button>
  </span>
</div>
