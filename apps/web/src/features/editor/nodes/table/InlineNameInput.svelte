<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { autofocus } from "@/actions/autofocus";

  /**
   * A name edited where it is written: same font, same place as the text it replaces, so opening it
   * never resizes the table. It takes the free room next to the name and underlines its whole area,
   * not the letters. `reserve` is the name as it was before editing: it keeps the box at least as wide
   * as the text it replaces, whatever is typed.
   */
  let {
    value = $bindable(""),
    reserve,
    class: className = "",
    ...rest
  }: HTMLInputAttributes & { reserve: string; class?: string } = $props();
</script>

<span class={`inline-name ${className}`}>
  <span aria-hidden="true" class="inline-name-reserve">{reserve}</span>
  <input use:autofocus bind:value spellcheck="false" autocomplete="off" class="inline-name-input" {...rest} />
</span>

<style>
  .inline-name {
    position: relative;
    display: grid;
    flex: 1 1 auto;
    min-width: 0;
    /* Room under the letters for the line, given back as a negative margin so the box keeps its height. */
    padding-bottom: 2px;
    margin-bottom: -2px;
  }
  .inline-name::after {
    content: "";
    position: absolute;
    inset: auto 0 0 0;
    height: 1px;
    background: currentColor;
    opacity: 0.7;
  }
  .inline-name-reserve {
    grid-area: 1 / 1;
    visibility: hidden;
    overflow: hidden;
    white-space: pre;
  }
  .inline-name-input {
    grid-area: 1 / 1;
    width: 0;
    min-width: 100%;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    outline: none;
    box-shadow: none;
    color: inherit;
    caret-color: currentColor;
    font: inherit;
    letter-spacing: inherit;
    line-height: inherit;
  }
</style>
