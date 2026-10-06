<script lang="ts" module>
  import type { EnvironmentColor } from "@nebuladb/shared";

  /** A stage's colour as a CSS value — tokens only, so both themes get a readable shade. */
  export const STAGE_COLOR: Record<EnvironmentColor, string> = {
    green: "var(--color-success)",
    blue: "var(--color-info)",
    violet: "var(--color-stage-violet)",
    amber: "var(--color-warning)",
    orange: "var(--color-stage-orange)",
    red: "var(--color-danger)",
    grey: "var(--color-text-muted)",
  };
</script>

<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * A connection's deployment stage, everywhere one is shown: a pill in the
   * stage's colour. The production stage is red whatever colour it was given
   * — the one signal that must never depend on someone's palette choice.
   */
  let {
    name,
    color = "grey",
    production = false,
    class: className = "",
  }: { name: string; color?: EnvironmentColor; production?: boolean; class?: string } = $props();

  const { t } = useTranslation();
  const shade = $derived(production ? STAGE_COLOR.red : STAGE_COLOR[color]);
</script>

<span
  class={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-bold uppercase ${className}`.trim()}
  style:color={shade}
  style:border-color={`color-mix(in srgb, ${shade} 45%, transparent)`}
  style:background-color={`color-mix(in srgb, ${shade} 14%, transparent)`}
  data-production={production ? "true" : undefined}
  data-tooltip={production ? t("environments.productionHint") : undefined}
>
  <span class="h-1.5 w-1.5 rounded-full" style:background-color={shade}></span>
  {name}
</span>
