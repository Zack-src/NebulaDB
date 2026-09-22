<script lang="ts">
  import type { Snippet } from "svelte";

  /** Vertical stack of `ListRow`s — used for admin tables (invitations/users/teams/team members). */
  let { children }: { children: Snippet } = $props();
</script>

<div class="flex flex-col gap-1.5">{@render children()}</div>
