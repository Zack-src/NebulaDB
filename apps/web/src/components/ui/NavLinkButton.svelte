<script lang="ts">
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import Icon from "@/components/icons/Icon.svelte";
  import Button from "@/components/ui/Button.svelte";

  /**
   * A button that takes the person to another part of the app ("Admin → Connections",
   * "Settings → Databases"). The one look for those links, so every place that points
   * elsewhere reads the same. Renders nothing without `onNavigate`: the caller passes it
   * only to people who may go there.
   */
  let {
    label,
    icon,
    onNavigate,
    size = "sm",
    variant = "outline",
  }: {
    label: string;
    icon?: IconDefinition;
    onNavigate?: () => void;
    size?: "xs" | "sm" | "md";
    /** `ghost` for a quiet link inside a sentence of hints, `outline` where it is the call to action. */
    variant?: "outline" | "ghost";
  } = $props();
</script>

{#if onNavigate}
  <Button {variant} {size} onclick={onNavigate}>
    {#if icon}<Icon {icon} size={13} />{/if}
    {label}
  </Button>
{/if}
