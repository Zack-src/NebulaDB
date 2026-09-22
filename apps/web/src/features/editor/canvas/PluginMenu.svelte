<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { PuzzleIcon } from "@/components/icons/Icons";
  import { CANVAS_TOOLBAR_ICON_BTN_CLASS, CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS } from "@/components/ui/canvasToolbarStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
  import PluginQuickPalette from "@/features/plugins/PluginQuickPalette.svelte";
  import ToolbarMenu from "./ToolbarMenu.svelte";

  let {
    commands,
    onRun,
    onOpenPlugins,
  }: {
    commands: ResolvedContribution<CanvasCommandContribution>[];
    onRun: (command: ResolvedContribution<CanvasCommandContribution>) => void;
    onOpenPlugins: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<ToolbarMenu
  tooltip={t("canvas.plugins.tooltip")}
  minWidth={300}
  triggerClassName={(open) => `${CANVAS_TOOLBAR_ICON_BTN_CLASS} ${open ? CANVAS_TOOLBAR_SEGMENT_ACTIVE_CLASS : ""}`}
>
  {#snippet triggerContent()}<Icon icon={PuzzleIcon} size={16} />{/snippet}
  {#snippet children(close)}
    <PluginQuickPalette {commands} {onRun} {onOpenPlugins} onClose={close} />
  {/snippet}
</ToolbarMenu>
