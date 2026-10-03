<script lang="ts" module>
  export type SwitchSize = "md" | "sm";

  const TRACK: Record<SwitchSize, string> = { md: "h-5 w-9", sm: "h-4 w-7" };
  const THUMB: Record<SwitchSize, string> = { md: "h-4 w-4", sm: "h-3 w-3" };
  const TRAVEL: Record<SwitchSize, string> = { md: "translate-x-4", sm: "translate-x-3" };
</script>

<script lang="ts">
  /**
   * An on/off setting that takes effect immediately — use `Checkbox` for a
   * value that is only applied when a form is submitted.
   *
   * A `<button role="switch">`, so Space and Enter toggle it and it is labelable:
   * wrap it in a `<label>` (see `SettingSwitch`) or pass `aria-label` /
   * `aria-labelledby`.
   */
  let {
    checked = $bindable(false),
    onChange,
    disabled = false,
    size = "md",
    id,
    class: className = "",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    disabled?: boolean;
    size?: SwitchSize;
    id?: string;
    class?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  {id}
  {disabled}
  aria-checked={checked}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  class={`inline-flex shrink-0 items-center rounded-full border p-px transition-colors duration-base
    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
    disabled:cursor-not-allowed disabled:opacity-50
    ${TRACK[size]} ${checked ? "border-primary bg-primary" : "border-border-strong bg-surface-hover"} ${className}`}
  onclick={() => {
    checked = !checked;
    onChange?.(checked);
  }}
>
  <span
    class={`rounded-full bg-white shadow-xs transition-transform duration-base ease-emphasized ${THUMB[size]} ${checked ? TRAVEL[size] : ""}`}
  ></span>
</button>
