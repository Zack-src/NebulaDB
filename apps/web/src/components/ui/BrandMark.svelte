<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { LogoMarkIcon } from "@/components/icons/Icons";

  /** The gradient square logo mark used in every header and the auth-page cards. */
  let { size = 26, iconSize = 15, class: className = "" }: { size?: number; iconSize?: number; class?: string } =
    $props();
</script>

<span
  class={`flex items-center justify-center rounded-sm bg-gradient-to-br from-primary to-[#7c3aed] text-white ${className}`}
  style:width="{size}px"
  style:height="{size}px"
>
  <Icon icon={LogoMarkIcon} size={iconSize} style="color: white" />
</span>
