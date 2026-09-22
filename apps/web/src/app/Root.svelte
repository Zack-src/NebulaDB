<script lang="ts">
  import App from "@/app/App.svelte";
  import ErrorBoundary from "@/app/ErrorBoundary.svelte";
  import GlobalTooltip from "@/components/overlays/GlobalTooltip.svelte";
  import { i18n } from "@/i18n/i18n.svelte";

  /**
   * Canvas perf harness (`features/editor/bench`): the real editor over a
   * synthetic schema of a chosen size, no server behind it. Routed here rather
   * than inside `App` so it bypasses auth and project loading entirely, and
   * dynamically imported so it costs a normal session nothing — the chunk is
   * only fetched when someone opens `/#bench`.
   *
   * `/#components` (`components/dev/ComponentCatalogue`) has the same shape
   * for the same reason: no auth, no project, lazy-loaded so a normal session
   * never fetches it.
   */
  const route = window.location.hash.startsWith("#bench")
    ? "bench"
    : window.location.hash.startsWith("#components")
      ? "components"
      : "app";

  i18n.install();
</script>

{#if route === "bench"}
  {#await import("@/features/editor/bench/BenchHarness.svelte") then { default: BenchHarness }}
    <BenchHarness />
  {/await}
{:else if route === "components"}
  {#await import("@/components/dev/ComponentCatalogue.svelte") then { default: ComponentCatalogue }}
    <ComponentCatalogue />
  {/await}
{:else}
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
{/if}
<GlobalTooltip />
