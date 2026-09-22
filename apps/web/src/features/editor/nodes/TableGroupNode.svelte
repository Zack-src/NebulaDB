<script lang="ts" module>
  const ACCENT = "#a855f7"; // accent-purple — distinct from zones (amber) and enums (cyan)
</script>

<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { MAX_NAME_LENGTH } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
  import type { TableGroupNodeType } from "@/features/editor/nodes/nodeTypes";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * A dashed outline around a group's member tables, purely derived — the
   * node builder computes this node's position/size from wherever its member
   * tables currently sit, so unlike Zone there's nothing to drag or resize
   * here: `draggable: false` and the box itself is `pointer-events: none` so
   * clicks fall through to whatever table is actually underneath. Only the
   * label pill is interactive.
   */
  let { data }: NodeProps<TableGroupNodeType> = $props();

  const { t } = useTranslation();
  const group = $derived(data.group);
  const readOnly = $derived(Boolean(data.readOnly));
  let editing = $state(false);
  const draft = useDraftValue(
    () => data.group.name,
    (next) => data.onRename(next ?? ""),
  );
</script>

<div class="pointer-events-none relative h-full w-full">
  <div class="absolute inset-0 rounded-xl" style:border="1.5px dashed {ACCENT}70" style:background="{ACCENT}0a"></div>
  <div
    class="pointer-events-auto absolute -top-3 left-3 flex items-center gap-1.5 rounded-full border px-2 py-0.5 shadow-sm"
    style:background="var(--color-surface)"
    style:border-color="{ACCENT}80"
  >
    {#if editing}
      <input
        use:autofocus
        class={`nodrag ${INPUT_XS_CLASS} h-[20px] text-[11px] font-bold`}
        bind:value={draft.value}
        maxlength={MAX_NAME_LENGTH}
        onblur={() => {
          draft.commit();
          editing = false;
        }}
        onkeydown={(event) => {
          draft.handleKeyDown(event);
          if (event.key === "Enter") editing = false;
          if (event.key === "Escape") {
            draft.setValue(group.name);
            editing = false;
          }
        }}
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="text-[11px] font-bold"
        style:color={ACCENT}
        ondblclick={() => {
          if (!readOnly) editing = true;
        }}
        data-tooltip={readOnly ? undefined : t("node.doubleClickToRename")}
      >
        {group.name} · {data.memberCount}
      </span>
    {/if}
    {#if !readOnly}
      <button
        type="button"
        class="nodrag flex h-4 w-4 items-center justify-center rounded-full text-[13px] leading-none text-text-muted transition-colors hover:bg-danger-light hover:text-danger"
        onclick={data.onUngroup}
        data-tooltip={t("tableGroup.ungroup")}
        aria-label={t("tableGroup.ungroup")}
      >
        ×
      </button>
    {/if}
  </div>
</div>
