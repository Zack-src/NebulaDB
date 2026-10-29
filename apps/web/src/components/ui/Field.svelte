<script lang="ts">
  import Input, { type InputProps } from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";

  /** Vertically-stacked label + field, used on auth screens and settings forms. Pass `hint` for helper text, `error` for a validation message (which also turns the field red). */
  const uid = $props.id();

  let {
    label,
    hint,
    error,
    class: className = "",
    value = $bindable(),
    id,
    ...rest
  }: { label: string; hint?: string | null; error?: string | null } & InputProps = $props();

  const inputId = $derived(id ?? `${uid}-input`);
  const messageId = $derived(`${uid}-message`);
  const hasMessage = $derived(Boolean(error) || Boolean(hint));
</script>

<div class="mb-4 flex flex-col gap-1.5">
  <label for={inputId} class={LABEL_CLASS}>{label}</label>
  <Input
    class={className}
    invalid={Boolean(error)}
    wrapperClassName="w-full"
    bind:value
    id={inputId}
    aria-invalid={error ? true : undefined}
    aria-describedby={hasMessage ? messageId : undefined}
    {...rest}
  />
  {#if error}
    <span id={messageId} role="alert" class="text-label text-danger">{error}</span>
  {:else if hint}
    <span id={messageId} class="text-label text-text-muted">{hint}</span>
  {/if}
</div>
