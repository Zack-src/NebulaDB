<script lang="ts" module>
  const ACCENT = "#06b6d4"; // accent-cyan — distinct from tables (primary) and zones (amber)
</script>

<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { MAX_NAME_LENGTH } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TagIcon } from "@/components/icons/Icons";
  import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
  import type { EnumNodeType } from "@/features/editor/nodes/nodeTypes";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import EnumValueRow from "./EnumValueRow.svelte";

  let { data, selected = false }: NodeProps<EnumNodeType> = $props();

  const { t } = useTranslation();
  const enumDef = $derived(data.enumDef);
  const readOnly = $derived(Boolean(data.readOnly));
  let editingName = $state(false);
  const nameDraft = useDraftValue(
    () => data.enumDef.name,
    (next) => data.onRename(next ?? ""),
  );
</script>

<div
  class={`w-[200px] overflow-hidden rounded-lg border bg-surface shadow-md transition-shadow ${selected ? "shadow-lg" : ""}`}
  style:border-color={selected ? ACCENT : "var(--color-border)"}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex items-center gap-1.5 px-2.5 py-1.5"
    style:background="{ACCENT}22"
    style:border-bottom="1px solid {ACCENT}55"
    ondblclick={() => {
      if (!readOnly) editingName = true;
    }}
  >
    <Icon icon={TagIcon} size={12} style="color: {ACCENT}" />
    {#if editingName}
      <input
        use:autofocus
        class={`nodrag ${INPUT_XS_CLASS} flex-1 font-bold text-[calc(12px_*_var(--canvas-font-scale))]`}
        bind:value={nameDraft.value}
        maxlength={MAX_NAME_LENGTH}
        onblur={() => {
          nameDraft.commit();
          editingName = false;
        }}
        onkeydown={(event) => {
          nameDraft.handleKeyDown(event);
          if (event.key === "Enter") editingName = false;
          if (event.key === "Escape") {
            nameDraft.setValue(enumDef.name);
            editingName = false;
          }
        }}
      />
    {:else}
      <span
        class="flex-1 truncate font-bold text-[calc(12px_*_var(--canvas-font-scale))]"
        style:color={ACCENT}
        data-tooltip={readOnly ? undefined : t("node.doubleClickToRename")}
      >
        {enumDef.name}
      </span>
    {/if}
  </div>

  <div class="divide-y divide-border/60 py-0.5">
    {#if enumDef.values.length === 0}
      <div class="px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] italic text-text-muted">
        {t("enum.empty")}
      </div>
    {/if}
    {#each enumDef.values as v, i (v.id)}
      <EnumValueRow
        value={v}
        isFirst={i === 0}
        isLast={i === enumDef.values.length - 1}
        {readOnly}
        onRename={(name) => data.onRenameValue(v.id, name)}
        onDelete={() => data.onDeleteValue(v.id)}
        onMove={(direction) => data.onReorderValue(v.id, direction)}
      />
    {/each}
  </div>

  {#if !readOnly}
    <button
      type="button"
      class="nodrag flex w-full items-center gap-1.5 border-t border-border/60 px-2.5 py-1.5 text-[calc(11px_*_var(--canvas-font-scale))] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      onclick={data.onAddValue}
    >
      <Icon icon={PlusIcon} size={11} />
      {t("enum.addValue")}
    </button>
  {/if}
</div>
