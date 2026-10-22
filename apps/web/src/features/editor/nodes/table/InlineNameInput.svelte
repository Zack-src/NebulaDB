<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { autofocus } from "@/actions/autofocus";

  /**
   * A name edited where it is written: same font, same place, same width as the text it replaces, so
   * opening it never moves or resizes the table. Only an underline and the caret say it is being edited.
   * The hidden twin holds the width: the input stretches to fill the box the twin makes.
   */
  let { value = $bindable(""), class: className = "", ...rest }: HTMLInputAttributes & { class?: string } = $props();
</script>

<span class={`relative inline-grid min-w-[2ch] max-w-full ${className}`}>
  <span aria-hidden="true" class="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre pr-px">{value}</span>
  <input
    use:autofocus
    bind:value
    spellcheck="false"
    autocomplete="off"
    class="col-start-1 row-start-1 m-0 w-0 min-w-full appearance-none rounded-none border-0 bg-transparent p-0 text-inherit caret-current underline decoration-current/70 decoration-1 underline-offset-2 focus:outline-hidden"
    {...rest}
  />
</span>
