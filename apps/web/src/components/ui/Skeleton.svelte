<script lang="ts">
  /**
   * Placeholder blocks shown while first-load data is in flight.
   *
   * The problem this solves isn't cosmetic. Lists here derive "empty" from an
   * array being empty, and an array is also empty before its fetch resolves —
   * so a user with twenty projects was briefly told they had none, then watched
   * the message be replaced. A wrong statement is worse than a blank space;
   * these make the difference between "nothing here" and "not known yet"
   * visible.
   *
   * `aria-hidden` because there is nothing to read: the live region that
   * matters is the content that replaces it.
   */
  let { class: className = "" }: { class?: string } = $props();
</script>

<div aria-hidden="true" class={`animate-pulse-subtle rounded-md bg-surface-hover ${className}`}></div>
