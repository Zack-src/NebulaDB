<script lang="ts" module>
  import type { CanvasPoint } from "./types";

  export interface CanvasContextMenuState {
    screenX: number;
    screenY: number;
    flowPosition: CanvasPoint;
  }
</script>

<script lang="ts">
  import { menuPlacement } from "@/actions/placement";
  import Icon from "@/components/icons/Icon.svelte";
  import { FrameIcon, NoteIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
  import { CONTEXT_MENU_CLASS, CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /** Right-click-on-empty-canvas menu — the only way to add a node besides editing DBML directly. */
  let {
    menu,
    onAddTable,
    onAddZone,
    onAddNote,
    onAddEnum,
    onClose,
  }: {
    menu: CanvasContextMenuState;
    onAddTable: (position: CanvasPoint) => void;
    onAddZone: (position: CanvasPoint) => void;
    onAddNote: (position: CanvasPoint) => void;
    onAddEnum: (position: CanvasPoint) => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();

  function addAtCursor(add: (position: CanvasPoint) => void) {
    add(menu.flowPosition);
    onClose();
  }

  const items = $derived([
    { icon: TableIcon, labelKey: "canvas.addTable", add: onAddTable },
    { icon: FrameIcon, labelKey: "canvas.addZone", add: onAddZone },
    { icon: NoteIcon, labelKey: "canvas.addNote", add: onAddNote },
    { icon: TagIcon, labelKey: "canvas.addEnum", add: onAddEnum },
  ] as const);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  use:menuPlacement={{ x: menu.screenX, y: menu.screenY }}
  class={CONTEXT_MENU_CLASS}
  role="menu"
  tabindex="-1"
  onclick={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.preventDefault()}
>
  {#each items as item (item.labelKey)}
    <button class={CONTEXT_MENU_ITEM_CLASS} onclick={() => addAtCursor(item.add)}>
      <Icon icon={item.icon} size={14} />
      {t(item.labelKey)}
    </button>
  {/each}
</div>
