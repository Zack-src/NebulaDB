<script lang="ts">
  import Input, { type InputProps } from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";

  /** Vertically-stacked label + field, used on auth screens and settings forms. Pass `hint` for helper text, `error` for a validation message (which also turns the field red). */
  let {
    label,
    hint,
    error,
    class: className = "",
    value = $bindable(),
    ...rest
  }: { label: string; hint?: string | null; error?: string | null } & InputProps = $props();
</script>

<label class="mb-4 flex flex-col gap-1.5">
  <span class={LABEL_CLASS}>{label}</span>
  <Input class={className} invalid={Boolean(error)} wrapperClassName="w-full" bind:value {...rest} />
  {#if error}
    <span class="text-[11.5px] text-danger">{error}</span>
  {:else if hint}
    <span class="text-[11.5px] text-text-muted">{hint}</span>
  {/if}
</label>
