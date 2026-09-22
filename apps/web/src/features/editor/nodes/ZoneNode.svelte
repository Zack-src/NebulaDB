<script lang="ts" module>
  const DEFAULT_COLOR = "#f59e0b";
</script>

<script lang="ts">
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { MAX_NAME_LENGTH } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import ColorSwatchPicker from "@/components/inputs/ColorSwatchPicker.svelte";
  import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
  import type { ZoneNodeType } from "@/features/editor/nodes/nodeTypes";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { data, selected = false }: NodeProps<ZoneNodeType> = $props();

  const { t } = useTranslation();
  const zone = $derived(data.zone);
  let editing = $state(false);
  const draft = useDraftValue(
    () => data.zone.label,
    (next) => data.onLabelChange(next ?? ""),
  );
  const color = $derived(zone.style?.color ?? DEFAULT_COLOR);
</script>

<NodeResizer
  minWidth={80}
  minHeight={80}
  isVisible={selected && !data.readOnly}
  onResizeEnd={(_, params) => data.onResize({ x: params.x, y: params.y }, { width: params.width, height: params.height })}
/>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative box-border h-full w-full rounded-lg"
  style:background="{color}1f"
  style:border="1.5px dashed {zone.style?.borderColor ?? color}"
  ondblclick={() => {
    if (!data.readOnly) editing = true;
  }}
>
  <div class="absolute left-2.5 top-2 flex items-center gap-1.5">
    {#if editing}
      <input
        use:autofocus
        class={`nodrag ${INPUT_XS_CLASS} text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold`}
        bind:value={draft.value}
        onblur={() => {
          draft.commit();
          editing = false;
        }}
        maxlength={MAX_NAME_LENGTH}
        onkeydown={(event) => {
          draft.handleKeyDown(event);
          if (event.key === "Enter") editing = false;
          if (event.key === "Escape") {
            draft.setValue(zone.label);
            editing = false;
          }
        }}
      />
    {:else}
      <span
        class="text-[calc(12.5px_*_var(--canvas-font-scale))] font-bold tracking-[-0.01em]"
        style:color
        data-tooltip={data.readOnly ? undefined : t("node.doubleClickToRename")}
      >
        {zone.label}
      </span>
    {/if}
    {#if !data.readOnly}
      <ColorSwatchPicker
        value={color}
        onChange={data.onColorChange}
        palette={data.palette}
        onPaletteChange={data.onPaletteChange}
        triggerClassName="h-[15px] w-[15px] cursor-pointer rounded-full border-[1.5px] border-white/80 bg-none p-0 shadow-xs"
        tooltip={t("zone.color")}
      />
    {/if}
  </div>
</div>
