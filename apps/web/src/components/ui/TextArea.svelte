<script lang="ts" module>
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import {
    INPUT_INVALID_CLASS,
    TEXTAREA_CLASS,
    TEXTAREA_CODE_CLASS,
    TEXTAREA_SM_CLASS,
  } from "@/components/ui/inputStyles";

  export type TextAreaVariant = "default" | "sm" | "code";

  const VARIANT_CLASS: Record<TextAreaVariant, string> = {
    default: TEXTAREA_CLASS,
    sm: TEXTAREA_SM_CLASS,
    code: TEXTAREA_CODE_CLASS,
  };

  export interface TextAreaProps extends HTMLTextareaAttributes {
    variant?: TextAreaVariant;
    invalid?: boolean;
    /** Grows with its content up to `maxRows` lines, then scrolls. */
    autoGrow?: boolean;
    maxRows?: number;
    ref?: HTMLTextAreaElement | null;
  }
</script>

<script lang="ts">
  /**
   * Multi-line text. `variant="code"` is the monospace pane for DBML / SQL
   * source; `autoGrow` is for comment and note composers, where a fixed box is
   * either too tall when empty or too short after three lines.
   */
  let {
    variant = "default",
    invalid = false,
    autoGrow = false,
    maxRows = 10,
    class: className = "",
    value = $bindable(),
    ref = $bindable(null),
    ...rest
  }: TextAreaProps = $props();

  $effect(() => {
    // Read so the effect re-runs on every edit, including programmatic ones.
    void value;
    if (!autoGrow || !ref) return;
    const style = getComputedStyle(ref);
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    const limit = parseFloat(style.lineHeight) * maxRows + chrome;
    // Collapsed first: `scrollHeight` never shrinks below the current height.
    ref.style.height = "auto";
    const wanted = ref.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    ref.style.height = `${Math.min(wanted, limit)}px`;
    ref.style.overflowY = wanted > limit ? "auto" : "hidden";
  });
</script>

<textarea
  bind:this={ref}
  bind:value
  aria-invalid={invalid || undefined}
  class={`${VARIANT_CLASS[variant]} ${invalid ? INPUT_INVALID_CLASS : ""} ${autoGrow ? "resize-none" : ""} ${className}`
    .replace(/\s+/g, " ")
    .trim()}
  {...rest}
></textarea>
