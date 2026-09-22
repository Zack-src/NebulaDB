<script lang="ts">
  import { menuPlacement } from "@/actions/placement";
  import { portal } from "@/actions/portal";
  import Icon from "@/components/icons/Icon.svelte";
  import { PaletteIcon, PlusIcon, RestoreIcon, SwapHorizontalIcon, TrashIcon } from "@/components/icons/Icons";
  import {
    CONTEXT_MENU_CLASS,
    CONTEXT_MENU_DANGER_ITEM_CLASS,
    CONTEXT_MENU_ITEM_CLASS,
    CONTEXT_MENU_SEPARATOR_CLASS,
  } from "@/components/ui/contextMenuStyles";
  import { EDGE_MENU_ATTRIBUTE, type EdgeContextMenuState } from "@/features/editor/edges/edgeRouting.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Right-click menu on an edge's path or a specific waypoint — also reachable
   * from the gear button on the selected-edge toolbar. Portaled to
   * document.body for precise positioning.
   *
   * Every entry closes the menu through one wrapper rather than each action
   * remembering to do it: "insert waypoint" and "reset colour" both used to
   * leave it hanging open, which reads as a click that did not register and
   * gets people inserting the same waypoint twice.
   */
  let props: {
    menu: EdgeContextMenuState;
    onClose: () => void;
    onInsertPoint: (position: EdgeContextMenuState["flowPosition"]) => void;
    onDeletePoint: (index: number) => void;
    onResetRouting: () => void;
    onResetColor?: () => void;
    onReverseDirection?: () => void;
    onDeleteRef?: () => void;
  } = $props();

  const { t } = useTranslation();
  const choose = (action: () => void) => () => {
    action();
    props.onClose();
  };
</script>

<div
  use:portal
  use:menuPlacement={{ x: props.menu.x, y: props.menu.y }}
  {...{ [EDGE_MENU_ATTRIBUTE]: "" }}
  class={`${CONTEXT_MENU_CLASS} nodrag nopan`}
  role="menu"
  tabindex="-1"
  oncontextmenu={(event) => event.preventDefault()}
>
  {#if props.menu.pointIndex !== undefined}
    <button class={CONTEXT_MENU_ITEM_CLASS} onclick={choose(() => props.onDeletePoint(props.menu.pointIndex!))}>
      <Icon icon={TrashIcon} size={14} />
      {t("edge.deleteWaypoint")}
    </button>
  {:else}
    <button class={CONTEXT_MENU_ITEM_CLASS} onclick={choose(() => props.onInsertPoint(props.menu.flowPosition))}>
      <Icon icon={PlusIcon} size={14} />
      {t("edge.insertWaypoint")}
    </button>
  {/if}
  <button class={CONTEXT_MENU_ITEM_CLASS} onclick={choose(props.onResetRouting)}>
    <Icon icon={RestoreIcon} size={14} />
    {t("edge.resetPathShort")}
  </button>
  {#if props.onResetColor}
    <button class={CONTEXT_MENU_ITEM_CLASS} onclick={choose(props.onResetColor)}>
      <Icon icon={PaletteIcon} size={14} />
      {t("edge.resetColor")}
    </button>
  {/if}
  {#if props.onReverseDirection}
    <button class={CONTEXT_MENU_ITEM_CLASS} onclick={choose(props.onReverseDirection)}>
      <Icon icon={SwapHorizontalIcon} size={14} />
      {t("edge.reverseDirection")}
    </button>
  {/if}
  {#if props.onDeleteRef}
    <div class={CONTEXT_MENU_SEPARATOR_CLASS}></div>
    <button class={CONTEXT_MENU_DANGER_ITEM_CLASS} onclick={choose(props.onDeleteRef)}>
      <Icon icon={TrashIcon} size={14} />
      {t("edge.deleteRelation")}
    </button>
  {/if}
</div>
