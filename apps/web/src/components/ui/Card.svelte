<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  interface Props extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    variant?: "default" | "glass" | "glow" | "outline";
    interactive?: boolean;
  }

  let { children, variant = "default", interactive = false, class: className = "", ...rest }: Props = $props();

  const baseStyles = "rounded-xl border transition-[transform,border-color,box-shadow] duration-150 ease-out";

  const variantStyles = $derived(
    {
      default: "bg-surface border-border shadow-xs",
      // Explicit border colour: `.glass-card` only owns the fill and the blur
      // now, and preflight is disabled — a bare `border` with no colour utility
      // would paint in `currentColor`.
      glass: "glass-card border-white/[0.06] shadow-sm",
      glow: "bg-surface-raised border-primary-border shadow-lg",
      outline: "bg-transparent border-border hover:border-border-strong",
    }[variant],
  );

  // A half-pixel lift, not a hop: the card should acknowledge the cursor, not
  // jump out from under it.
  const hoverStyles = $derived(
    interactive ? "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md" : "",
  );
</script>

<div class={`${baseStyles} ${variantStyles} ${hoverStyles} ${className}`.trim()} {...rest}>
  {@render children()}
</div>
