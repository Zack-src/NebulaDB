<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";

  export interface TabItem<T extends string = string> {
    id: T;
    label: string;
    icon?: IconDefinition;
    badge?: string | number;
  }

  /** DOM ids shared by a tab and its panel, for callers that render the `role="tabpanel"` themselves. */
  export const tabDomId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
  export const panelDomId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

  const FOCUS_RING =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
</script>

<script lang="ts" generics="T extends string = string">
  import { nextTabIndex } from "@/components/ui/tabsKeyboard";
  import Icon from "@/components/icons/Icon.svelte";

  /**
   * Three shapes for the same control. `line` heads a page, `boxed` is the
   * segmented switch inside a card, `pill` is the standalone filter row — all on
   * the 28px control height so a tab strip lines up with the buttons beside it.
   */
  let {
    tabs,
    activeTab,
    onChange,
    variant = "pill",
    activation = "auto",
    idPrefix,
    "aria-label": ariaLabel,
    class: className = "",
  }: {
    tabs: TabItem<T>[];
    activeTab: T;
    onChange: (tabId: T) => void;
    variant?: "pill" | "line" | "boxed";
    /** `auto` activates a tab as soon as arrow keys focus it; `manual` waits for Enter / Space. */
    activation?: "auto" | "manual";
    /**
     * Gives each tab `id={tabDomId(idPrefix, tab.id)}` and `aria-controls={panelDomId(idPrefix, tab.id)}`.
     * Pass it only when the matching `role="tabpanel"` elements exist, otherwise `aria-controls` would dangle.
     */
    idPrefix?: string;
    "aria-label"?: string;
    class?: string;
  } = $props();

  function onKeydown(event: KeyboardEvent) {
    const list = event.currentTarget as HTMLElement;
    const nodes = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || nodes.length === 0) return;
    const next = nextTabIndex(event.key, current, nodes.length);
    if (next === null) return;
    event.preventDefault();
    nodes[next].focus();
    if (activation === "auto") nodes[next].click();
  }
</script>

{#if variant === "line"}
  <!-- The tabs inside carry the roving tabindex. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div role="tablist" aria-label={ariaLabel} onkeydown={onKeydown} class={`flex gap-5 border-b border-border ${className}`.trim()}>
    {#each tabs as tab (tab.id)}
      {@const active = tab.id === activeTab}
      <button
        type="button"
        role="tab"
        id={idPrefix ? tabDomId(idPrefix, tab.id) : undefined}
        aria-controls={idPrefix ? panelDomId(idPrefix, tab.id) : undefined}
        aria-selected={active}
        tabindex={active ? 0 : -1}
        onclick={() => onChange(tab.id)}
        class={`-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-body-sm font-semibold transition-colors duration-150 ${FOCUS_RING} ${
          active
            ? "border-primary text-text"
            : "border-transparent text-text-muted hover:border-border-strong hover:text-text-secondary"
        }`}
      >
        {#if tab.icon}<Icon icon={tab.icon} />{/if}
        {tab.label}
        {#if tab.badge !== undefined}
          <span
            class={`rounded-full px-1.5 py-px text-micro font-bold tabular-nums ${
              active ? "bg-primary-light text-primary" : "bg-surface-hover text-text-muted"
            }`}
          >
            {tab.badge}
          </span>
        {/if}
      </button>
    {/each}
  </div>
{:else if variant === "boxed"}
  <!-- The tabs inside carry the roving tabindex. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div role="tablist" aria-label={ariaLabel} onkeydown={onKeydown} class={`flex gap-1 rounded-lg border border-border bg-surface p-1 ${className}`.trim()}>
    {#each tabs as tab (tab.id)}
      {@const active = tab.id === activeTab}
      <button
        type="button"
        role="tab"
        id={idPrefix ? tabDomId(idPrefix, tab.id) : undefined}
        aria-controls={idPrefix ? panelDomId(idPrefix, tab.id) : undefined}
        aria-selected={active}
        tabindex={active ? 0 : -1}
        onclick={() => onChange(tab.id)}
        class={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-body-sm font-medium transition-colors duration-150 ${FOCUS_RING} ${
          active
            ? "border border-border-strong bg-surface-raised font-semibold text-text shadow-xs"
            : "border border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
        }`}
      >
        {#if tab.icon}<Icon icon={tab.icon} />{/if}
        {tab.label}
      </button>
    {/each}
  </div>
{:else}
  <!-- Default: pill -->
  <!-- The tabs inside carry the roving tabindex. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div role="tablist" aria-label={ariaLabel} onkeydown={onKeydown} class={`flex flex-wrap gap-1.5 ${className}`.trim()}>
    {#each tabs as tab (tab.id)}
      {@const active = tab.id === activeTab}
      <button
        type="button"
        role="tab"
        id={idPrefix ? tabDomId(idPrefix, tab.id) : undefined}
        aria-controls={idPrefix ? panelDomId(idPrefix, tab.id) : undefined}
        aria-selected={active}
        tabindex={active ? 0 : -1}
        onclick={() => onChange(tab.id)}
        class={`flex h-7 items-center gap-1.5 rounded-full px-3 text-body-sm font-medium transition-colors duration-150 ${FOCUS_RING} ${
          active
            ? "border border-primary bg-primary font-semibold text-white"
            : "border border-border bg-surface-raised text-text-secondary hover:bg-surface-hover hover:text-text"
        }`}
      >
        {#if tab.icon}<Icon icon={tab.icon} />{/if}
        {tab.label}
      </button>
    {/each}
  </div>
{/if}
