<script lang="ts" module>
  export type BadgeTone = "admin" | "muted" | "warning" | "success" | "danger";

  const TONE: Record<BadgeTone, string> = {
    admin: "bg-primary-light text-primary",
    muted: "bg-surface-hover text-text-muted",
    warning: "bg-warning-light text-warning",
    success: "bg-success-light text-success",
    danger: "bg-danger-light text-danger",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  /** Small uppercase pill — admin/view-only/invitation-status labels. */
  let { tone, children, class: className = "" }: { tone: BadgeTone; children: Snippet; class?: string } = $props();
</script>

<span class={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase ${TONE[tone]} ${className}`.trim()}>
  {@render children()}
</span>
