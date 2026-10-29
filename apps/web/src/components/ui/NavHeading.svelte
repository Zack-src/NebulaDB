<script lang="ts">
  /** The small uppercase title above a group of `NavItem`s. */
  let { label }: { label: string } = $props();
</script>

<h2 class="m-0 px-3 pb-2 pt-1 text-label font-bold uppercase tracking-[0.08em] text-text">{label}</h2>
