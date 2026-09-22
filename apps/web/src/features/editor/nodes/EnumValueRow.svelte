<script lang="ts" module>
  /**
   * The glyph stays tiny — two of these stack inside one 24px row — but the
   * *target* is widened with a pseudo-element, so the pointer has something to
   * hit. At `h-2.5 w-3.5` these were a 10x14px target, well under any usable
   * minimum.
   */
  const REORDER_BTN_CLASS =
    "nodrag relative flex h-3 w-4 items-center justify-center text-[9px] leading-none text-text-muted " +
    "transition-colors hover:text-text disabled:opacity-20 " +
    "before:absolute before:left-1/2 before:top-1/2 before:h-5 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";
</script>

<script lang="ts">
  import { MAX_NAME_LENGTH, type EnumValue } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { TrashIcon } from "@/components/icons/Icons";
  import { INPUT_XS_CLASS } from "@/components/ui/inputStyles";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    value,
    isFirst,
    isLast,
    readOnly,
    onRename,
    onDelete,
    onMove,
  }: {
    value: EnumValue;
    isFirst: boolean;
    isLast: boolean;
    readOnly: boolean;
    onRename: (name: string) => void;
    onDelete: () => void;
    onMove: (direction: "up" | "down") => void;
  } = $props();

  const { t } = useTranslation();
  let editing = $state(false);
  const draft = useDraftValue(
    () => value.name,
    (next) => onRename(next ?? ""),
  );
</script>

<div class="group/row flex items-center gap-1 px-2.5 py-1 hover:bg-surface-hover/60">
  <div class={`flex shrink-0 flex-col opacity-0 ${readOnly ? "" : "group-hover/row:opacity-100"}`}>
    <button
      type="button"
      class={REORDER_BTN_CLASS}
      disabled={isFirst}
      onclick={() => onMove("up")}
      data-tooltip={t("enum.moveUp")}
    >
      ▲
    </button>
    <button
      type="button"
      class={REORDER_BTN_CLASS}
      disabled={isLast}
      onclick={() => onMove("down")}
      data-tooltip={t("enum.moveDown")}
    >
      ▼
    </button>
  </div>

  {#if editing}
    <input
      use:autofocus
      class={`nodrag ${INPUT_XS_CLASS} flex-1 font-mono text-[calc(11.5px_*_var(--canvas-font-scale))]`}
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
          draft.setValue(value.name);
          editing = false;
        }
      }}
    />
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="flex-1 truncate font-mono text-[calc(11.5px_*_var(--canvas-font-scale))] text-text-secondary"
      ondblclick={() => {
        if (!readOnly) editing = true;
      }}
      data-tooltip={readOnly ? undefined : t("node.doubleClickToRename")}
    >
      {value.name}
    </span>
  {/if}

  {#if !readOnly}
    <button
      type="button"
      class="nodrag shrink-0 text-text-muted opacity-0 transition-colors hover:text-danger group-hover/row:opacity-100"
      onclick={onDelete}
      data-tooltip={t("enum.deleteValue")}
      aria-label={t("enum.deleteValue")}
    >
      <Icon icon={TrashIcon} size={11} />
    </button>
  {/if}
</div>
