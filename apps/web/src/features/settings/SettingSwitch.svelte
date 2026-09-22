<script lang="ts">
  import { CHECKBOX_CLASS } from "@/components/ui/inputStyles";

  /**
   * A labelled on/off row. Built as a real `<label>` wrapping the checkbox so the
   * text names the control for assistive tech and clicking anywhere in the row
   * toggles it — the hand-rolled rows this replaces were bare `<input>`s beside
   * unassociated `<div>`s, with no accessible name at all.
   */
  let {
    label,
    hint,
    checked,
    onChange,
  }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void } = $props();
</script>

<label
  class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-3.5 transition-colors hover:border-border-strong"
>
  <span class="min-w-0">
    <span class="block text-xs font-bold text-text">{label}</span>
    <span class="block text-[11px] leading-normal text-text-muted">{hint}</span>
  </span>
  <input
    type="checkbox"
    class={`${CHECKBOX_CLASS} h-4 w-4`}
    {checked}
    onchange={(event) => onChange(event.currentTarget.checked)}
  />
</label>
