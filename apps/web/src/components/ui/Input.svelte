<script lang="ts" module>
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import { INPUT_CLASS, INPUT_INVALID_CLASS, INPUT_SM_CLASS, INPUT_XS_CLASS } from "@/components/ui/inputStyles";

  export type InputSize = "md" | "sm" | "xs";

  const SIZE_CLASS: Record<InputSize, string> = {
    md: INPUT_CLASS,
    sm: INPUT_SM_CLASS,
    xs: INPUT_XS_CLASS,
  };

  /** Left padding when a leading icon is rendered, per size. */
  const ICON_PADDING: Record<InputSize, string> = {
    md: "pl-8",
    sm: "pl-7",
    xs: "pl-[26px]",
  };

  export interface InputProps extends Omit<HTMLInputAttributes, "size"> {
    inputSize?: InputSize;
    /** Rendered inside the field, before the text (search glass, folder, hash…). */
    icon?: Snippet;
    /** Rendered inside the field, after the text (unit, counter, small button). */
    trailing?: Snippet;
    invalid?: boolean;
    /** Class applied to the wrapper rather than the input — put layout (width/flex) here. */
    wrapperClassName?: string;
    ref?: HTMLInputElement | null;
  }

  const ICON_OFFSET: Record<InputSize, string> = {
    md: "left-2.5",
    sm: "left-2",
    xs: "left-1.5",
  };
</script>

<script lang="ts">
  import { autofocus as focusOnMount } from "@/actions/autofocus";

  let {
    inputSize = "md",
    icon,
    trailing,
    invalid,
    class: className = "",
    wrapperClassName = "",
    value = $bindable(),
    ref = $bindable(null),
    // Routed through `use:autofocus` rather than the attribute: a field in a
    // dialog opened by a click has to take focus from the button that opened it.
    autofocus = false,
    ...rest
  }: InputProps = $props();

  const base = $derived(`${SIZE_CLASS[inputSize]} ${invalid ? INPUT_INVALID_CLASS : ""}`);
</script>

<!--
  Text field with optional in-field icon/adornment. Without either it renders a
  bare `<input>` so it stays a drop-in replacement for the raw element.
-->
{#if !icon && !trailing}
  <input
    bind:this={ref}
    bind:value
    use:focusOnMount={Boolean(autofocus)}
    class={`${base} ${wrapperClassName} ${className}`.replace(/\s+/g, " ").trim()}
    {...rest}
  />
{:else}
  <div class={`relative flex items-center ${wrapperClassName}`}>
    {#if icon}
      <span class={`pointer-events-none absolute ${ICON_OFFSET[inputSize]} flex text-text-muted`}>{@render icon()}</span>
    {/if}
    <input
      bind:this={ref}
      bind:value
      use:focusOnMount={Boolean(autofocus)}
      class={`${base} w-full ${icon ? ICON_PADDING[inputSize] : ""} ${trailing ? "pr-8" : ""} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      {...rest}
    />
    {#if trailing}
      <span class="absolute right-2 flex items-center text-text-muted">{@render trailing()}</span>
    {/if}
  </div>
{/if}
