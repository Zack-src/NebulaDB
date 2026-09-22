<script lang="ts">
  import type { IconDefinition } from "./iconDefinition";

  let {
    icon,
    size,
    class: className,
    style,
  }: {
    icon: IconDefinition;
    size?: number;
    class?: string;
    style?: string;
  } = $props();

  const pixels = $derived(size ?? icon.defaultSize);
</script>

<!--
  `aria-hidden`: every icon here is decorative — the control around it carries
  the name. Without it a screen reader announces the raw SVG alongside whatever
  label the button already has.
-->
<svg
  {...icon.attributes}
  xmlns="http://www.w3.org/2000/svg"
  width={pixels}
  height={pixels}
  class={className}
  {style}
  aria-hidden="true"
  focusable="false"
  ><!-- eslint-disable-next-line svelte/no-at-html-tags -- bundled SVG markup, never user input -->
  {@html icon.body}</svg
>
