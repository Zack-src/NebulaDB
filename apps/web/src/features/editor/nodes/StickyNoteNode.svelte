<script lang="ts" module>
  const DEFAULT_COLOR = "#fef08a";
</script>

<script lang="ts">
  import { NodeResizer, type NodeProps } from "@xyflow/svelte";
  import { MAX_TEXT_LENGTH } from "@athanordb/shared";
  import ColorSwatchPicker from "@/components/inputs/ColorSwatchPicker.svelte";
  import type { StickyNoteNodeType } from "@/features/editor/nodes/nodeTypes";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let { data, selected = false }: NodeProps<StickyNoteNodeType> = $props();

  const { t } = useTranslation();
  const note = $derived(data.note);
  const color = $derived(note.style?.color ?? DEFAULT_COLOR);
</script>

<NodeResizer
  minWidth={100}
  minHeight={80}
  isVisible={selected && !data.readOnly}
  onResizeEnd={(_, params) => data.onResize({ x: params.x, y: params.y }, { width: params.width, height: params.height })}
/>
<div
  class="box-border flex h-full w-full flex-col gap-1.5 rounded-sm p-2 shadow-sm"
  style:background={color}
  style:border="1px solid {note.style?.borderColor ?? '#ca8a04'}"
>
  <textarea
    class="nodrag flex-1 resize-none border-0 bg-transparent text-[calc(12.5px_*_var(--canvas-font-scale))] leading-[1.4] text-text-onlight outline-hidden placeholder:text-[rgba(35,37,42,0.45)] read-only:cursor-default"
    value={note.text}
    readonly={data.readOnly}
    oninput={(event) => data.onTextChange(event.currentTarget.value)}
    placeholder={data.readOnly ? "" : t("stickyNote.placeholder")}
    maxlength={MAX_TEXT_LENGTH}
  ></textarea>
  {#if !data.readOnly}
    <div class="flex justify-end">
      <ColorSwatchPicker
        value={color}
        onChange={data.onColorChange}
        palette={data.palette}
        onPaletteChange={data.onPaletteChange}
        triggerClassName="h-[15px] w-[15px] cursor-pointer rounded-full border-[1.5px] border-black/15 bg-none p-0"
        tooltip={t("stickyNote.color")}
      />
    </div>
  {/if}
</div>
