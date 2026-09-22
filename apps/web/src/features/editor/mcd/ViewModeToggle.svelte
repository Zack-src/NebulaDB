<script lang="ts" module>
  export type EditorViewMode = "mld" | "mcd";
</script>

<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS, CANVAS_TOOLBAR_SEGMENT_CLASS } from "@/components/ui/canvasToolbarStyles";

  /**
   * MLD/MCD switch — a pair of segments meant to sit *inside* `CanvasToolbar`
   * (and the MCD canvas's own equivalent pill), not floated on its own: it's
   * the same toolbar family as `DetailLevelDropdown`, just two always-visible
   * options instead of a popover, since there are only two.
   */
  let { value, onChange }: { value: EditorViewMode; onChange: (mode: EditorViewMode) => void } = $props();

  const { t } = useTranslation();
</script>

{#snippet option(mode: EditorViewMode, label: string, hint: string)}
  <button
    type="button"
    class={`${CANVAS_TOOLBAR_SEGMENT_CLASS} ${value === mode ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
    onclick={() => onChange(mode)}
    aria-pressed={value === mode}
    data-tooltip={hint}
    data-tooltip-pos="top"
  >
    {label}
  </button>
{/snippet}

{@render option("mld", t("canvas.view.mld"), t("canvas.view.mldHint"))}
{@render option("mcd", t("canvas.view.mcd"), t("canvas.view.mcdHint"))}
