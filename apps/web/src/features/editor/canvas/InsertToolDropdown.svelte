<script lang="ts" module>
  import { FrameIcon, NoteIcon, TableIcon, TagIcon } from "@/components/icons/Icons";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import type { TranslationKeyOf } from "@/types";
  import type { CanvasInsertTool } from "./types";

  const MENU_ICON_SIZE = 15;
  const TRIGGER_ICON_SIZE = 16;

  const TOOLS: { tool: CanvasInsertTool; icon: IconDefinition; labelKey: TranslationKeyOf }[] = [
    { tool: "table", icon: TableIcon, labelKey: "canvas.addTable" },
    { tool: "zone", icon: FrameIcon, labelKey: "canvas.addZone" },
    { tool: "note", icon: NoteIcon, labelKey: "canvas.addNote" },
    { tool: "enum", icon: TagIcon, labelKey: "canvas.addEnum" },
  ];
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon } from "@/components/icons/Icons";
  import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
  import {
    CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS,
    CANVAS_TOOLBAR_SEGMENT_CLASS,
    CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS,
  } from "@/components/ui/canvasToolbarStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ToolbarMenu from "./ToolbarMenu.svelte";

  /**
   * The four insert tools (table, zone, note, enum), collapsed into one dropdown
   * — the same shape as the detail-level control — instead of four permanent
   * icon buttons crowding the toolbar.
   *
   * Picking an entry arms that tool and closes the menu (`CanvasArea` then
   * places it wherever the canvas is next clicked, as many times as clicked —
   * this component only shows which tool, if any, is armed). Picking the
   * already-armed tool again disarms it, mirroring the toggle every other
   * canvas tool uses; `CanvasArea`'s `onSelectTool` already implements that
   * flip, so this component just calls it unconditionally.
   */
  let {
    activeTool,
    onSelectTool,
  }: {
    /** The armed tool, or `null` in ordinary selection mode — see `CanvasArea`. */
    activeTool: CanvasInsertTool | null;
    onSelectTool: (tool: CanvasInsertTool) => void;
  } = $props();

  const { t } = useTranslation();
  // Keeps showing the last-picked tool's icon on the trigger after it's been
  // placed and disarmed, rather than resetting to a generic glyph — the same
  // "remembers the last shape" convention Figma's own tool dropdown uses.
  let lastTool = $state<CanvasInsertTool>("table");
  const displayed = $derived(TOOLS.find((entry) => entry.tool === (activeTool ?? lastTool)) ?? TOOLS[0]);
</script>

<ToolbarMenu
  tooltip={t("canvas.insertTool.tooltip")}
  triggerClassName={(open) =>
    `${CANVAS_TOOLBAR_SEGMENT_CLASS} !px-2.5 ${
      activeTool ? CANVAS_TOOLBAR_TOGGLE_ACTIVE_CLASS : open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""
    }`}
>
  {#snippet triggerContent()}
    <Icon icon={displayed.icon} size={TRIGGER_ICON_SIZE} />
    <Icon icon={ChevronRightIcon} size={12} class="-rotate-90" />
  {/snippet}
  {#snippet children(close)}
    <!-- Icon, then label, then an optional checkmark — three direct children
         of the button rather than a wrapping span, because
         `CONTEXT_MENU_ITEM_CLASS` colours the icon through a `[&>svg]`
         selector that only matches an immediate child. -->
    {#each TOOLS as { tool, icon, labelKey } (tool)}
      <button
        type="button"
        class={`${CONTEXT_MENU_ITEM_CLASS} ${tool === activeTool ? "text-text" : ""}`}
        onclick={() => {
          lastTool = tool;
          onSelectTool(tool);
          close();
        }}
      >
        <Icon {icon} size={MENU_ICON_SIZE} />
        <span class="flex-1">{t(labelKey)}</span>
        {#if tool === activeTool}<span class="text-primary">✓</span>{/if}
      </button>
    {/each}
  {/snippet}
</ToolbarMenu>
