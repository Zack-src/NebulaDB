<script lang="ts" module>
  function initials(name: string): string {
    const parts = name
      .trim()
      .split(/[\s_-]+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
</script>

<script lang="ts">
  import type { AwarenessState } from "@/features/collaboration/yjsClient";

  let {
    localName,
    localColor,
    remote,
  }: { localName: string; localColor: string; remote: Map<number, AwarenessState> } = $props();

  const AVATAR_CLASS =
    "-ml-2 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-surface text-[11px] font-bold text-white first:ml-0";
</script>

{#snippet avatar(name: string, color: string)}
  <span class={AVATAR_CLASS} style:background={color} data-tooltip={name}>{initials(name)}</span>
{/snippet}

<div class="flex items-center">
  {@render avatar(`${localName} (you)`, localColor)}
  {#each Array.from(remote.entries()) as [clientId, state] (clientId)}
    {@render avatar(state.user.name, state.user.color)}
  {/each}
</div>
