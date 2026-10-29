<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import Switch from "@/components/ui/Switch.svelte";

  /**
   * A labelled on/off row, the same size as a `ListRow` so it lines up with
   * the lists and cards around it. Built as a real `<label>` wrapping the
   * switch so the text names the control for assistive tech and clicking
   * anywhere in the row toggles it.
   */
  let {
    label,
    hint,
    checked,
    onChange,
    icon,
    disabled = false,
  }: {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    icon?: IconDefinition;
    disabled?: boolean;
  } = $props();
</script>

<label
  class="flex items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong"
  class:cursor-pointer={!disabled}
  class:opacity-60={disabled}
>
  {#if icon}<Icon {icon} size={16} class="shrink-0 text-text-muted" />{/if}
  <span class="min-w-0 flex-1">
    <span class="block text-label font-semibold text-text">{label}</span>
    <span class="block text-caption leading-normal text-text-muted">{hint}</span>
  </span>
  <Switch size="sm" {checked} {disabled} {onChange} />
</label>
