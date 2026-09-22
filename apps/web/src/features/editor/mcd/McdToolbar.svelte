<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { InfoIcon, MinimapIcon, RestoreIcon } from "@/components/icons/Icons";
  import {
    CANVAS_TOOLBAR_DIVIDER_CLASS,
    CANVAS_TOOLBAR_ICON_BTN_CLASS,
    CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
  } from "@/components/ui/canvasToolbarStyles";
  import AnimatedToolbarPill from "@/components/ui/AnimatedToolbarPill.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ViewModeToggle, { type EditorViewMode } from "./ViewModeToggle.svelte";

  /**
   * The MCD canvas's bottom-centre pill — its own component (rather than
   * inline markup in `McdCanvas`) mainly so `McdCanvas` stays about *deriving
   * and rendering the graph*, not also owning every button's markup.
   */
  let {
    viewMode,
    onSetViewMode,
    onResetPositions,
    minimapVisible,
    onToggleMinimap,
  }: {
    viewMode: EditorViewMode;
    onSetViewMode: (mode: EditorViewMode) => void;
    onResetPositions: () => void;
    minimapVisible: boolean;
    onToggleMinimap: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<AnimatedToolbarPill pillId="editing-toolbar">
  <ViewModeToggle value={viewMode} onChange={onSetViewMode} />
  <span class={CANVAS_TOOLBAR_DIVIDER_CLASS}></span>
  <button
    type="button"
    class={CANVAS_TOOLBAR_ICON_BTN_CLASS}
    onclick={onResetPositions}
    data-tooltip={t("mcd.resetPositions")}
    data-tooltip-pos="top"
    aria-label={t("mcd.resetPositions")}
  >
    <Icon icon={RestoreIcon} size={16} />
  </button>
  <span class={CANVAS_TOOLBAR_DIVIDER_CLASS}></span>
  <button
    type="button"
    class={`${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${minimapVisible ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : ""}`}
    onclick={onToggleMinimap}
    aria-pressed={minimapVisible}
    data-tooltip={t(minimapVisible ? "canvas.hideMinimap" : "canvas.showMinimap")}
    data-tooltip-pos="top"
    aria-label={t("canvas.toggleMinimap")}
  >
    <Icon icon={MinimapIcon} size={16} />
  </button>
  <span class={CANVAS_TOOLBAR_DIVIDER_CLASS}></span>
  <!-- Replaces what used to be a permanently-visible banner over the canvas —
       the same information, but on demand instead of competing for attention
       on every frame. -->
  <button
    type="button"
    class={CANVAS_TOOLBAR_ICON_BTN_CLASS}
    data-tooltip={t("mcd.readOnlyNotice")}
    data-tooltip-pos="top"
    aria-label={t("mcd.readOnlyNotice")}
  >
    <Icon icon={InfoIcon} size={16} />
  </button>
</AnimatedToolbarPill>
