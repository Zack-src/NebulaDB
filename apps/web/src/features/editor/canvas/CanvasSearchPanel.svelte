<script lang="ts">
  import { Panel } from "@xyflow/svelte";
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronLeftIcon, CloseIcon, SearchIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /** 22px targets rather than the 2px of padding these used to be — stepping through matches is a repeated action. */
  const STEP_BUTTON_CLASS =
    "flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-muted " +
    "transition-colors duration-100 enabled:hover:bg-surface-hover enabled:hover:text-text disabled:opacity-30 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary";

  /** Ctrl/Cmd+F floating search box — find a table by name and jump the viewport to it. */
  let {
    query,
    onQueryChange,
    matchCount,
    activeIndex,
    onNext,
    onPrevious,
    onClose,
  }: {
    query: string;
    onQueryChange: (query: string) => void;
    matchCount: number;
    activeIndex: number;
    onNext: () => void;
    onPrevious: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const hasQuery = $derived(query.trim() !== "");
</script>

<Panel position="top-right" class="nodrag nopan !right-3 !top-3">
  <div class="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-raised py-1 pl-2.5 pr-1 shadow-lg">
    <Icon icon={SearchIcon} size={13} class="shrink-0 text-text-muted" />
    <input
      use:autofocus
      value={query}
      oninput={(event) => onQueryChange(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) onPrevious();
          else onNext();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      placeholder={t("canvas.search.placeholder")}
      aria-label={t("canvas.search.placeholder")}
      class="h-6 w-44 border-none bg-transparent px-1 text-[12.5px] text-text placeholder:text-text-muted focus:outline-hidden"
    />
    {#if hasQuery}
      <span class="shrink-0 whitespace-nowrap px-0.5 text-[11px] tabular-nums text-text-muted">
        {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : "0/0"}
      </span>
    {/if}
    <span class="mx-0.5 h-4 w-px shrink-0 bg-border"></span>
    <button
      type="button"
      class={STEP_BUTTON_CLASS}
      onclick={onPrevious}
      disabled={matchCount === 0}
      data-tooltip={t("canvas.search.previous")}
      aria-label={t("canvas.search.previous")}
    >
      <Icon icon={ChevronLeftIcon} size={13} class="rotate-90" />
    </button>
    <button
      type="button"
      class={STEP_BUTTON_CLASS}
      onclick={onNext}
      disabled={matchCount === 0}
      data-tooltip={t("canvas.search.next")}
      aria-label={t("canvas.search.next")}
    >
      <Icon icon={ChevronLeftIcon} size={13} class="-rotate-90" />
    </button>
    <button
      type="button"
      class={STEP_BUTTON_CLASS}
      onclick={onClose}
      data-tooltip={t("canvas.search.close")}
      aria-label={t("canvas.search.close")}
    >
      <Icon icon={CloseIcon} size={12} />
    </button>
  </div>
</Panel>
