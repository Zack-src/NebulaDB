<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import { INPUT_CLASS, INPUT_INVALID_CLASS, INPUT_SM_CLASS, INPUT_XS_CLASS } from "@/components/ui/inputStyles";

  export interface SelectOption<T> {
    value: T;
    label: string;
    icon?: IconDefinition;
    /** Second, quieter line under the label. */
    hint?: string;
    disabled?: boolean;
    /** Consecutive options sharing a group are listed under that heading. */
    group?: string;
  }

  export type SelectSize = "md" | "sm" | "xs";

  const SIZE_CLASS: Record<SelectSize, string> = {
    md: `${INPUT_CLASS} pr-7`,
    sm: `${INPUT_SM_CLASS} pr-6`,
    xs: `${INPUT_XS_CLASS} pr-6`,
  };

  /** Above this many options a search field appears, unless the caller decided. */
  const AUTO_SEARCH_THRESHOLD = 8;
  /** A second letter typed within this delay extends the type-ahead prefix instead of restarting it. */
  const TYPEAHEAD_RESET_MS = 600;

  /** Case- and accent-insensitive, so "eleve" finds "Élève". */
  function normalise(text: string): string {
    return text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }
</script>

<script lang="ts" generics="T">
  import { tick } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckIcon, ChevronRightIcon, SearchIcon } from "@/components/icons/Icons";
  import Popover from "@/components/ui/Popover.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The app's own `<select>`: a button showing the current choice, and a list
   * that can carry icons, hints, groups and a search field — none of which the
   * browser's menu can do, and which never looks the same on two platforms.
   *
   * ARIA select-only combobox: focus stays on the trigger (or on the search
   * field when there is one) and the highlighted option is announced through
   * `aria-activedescendant`. Closed, ArrowDown / ArrowUp / Enter / Space open
   * it; open, arrows and Home / End move, Enter picks, Escape and Tab close;
   * without a search field, typing letters jumps to the matching option.
   */
  let {
    value = $bindable(),
    options,
    onChange,
    placeholder,
    searchable = "auto",
    size = "md",
    disabled = false,
    invalid = false,
    class: className = "",
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
  }: {
    value?: T;
    options: readonly SelectOption<T>[];
    onChange?: (value: T) => void;
    placeholder?: string;
    searchable?: boolean | "auto";
    size?: SelectSize;
    disabled?: boolean;
    invalid?: boolean;
    /** Layout only (width / flex) — height and padding come from `size`. */
    class?: string;
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
  } = $props();

  const { t } = useTranslation();
  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  let open = $state(false);
  let query = $state("");
  /** Index into `visible`, or -1 when nothing is highlighted. */
  let active = $state(-1);
  let trigger: HTMLButtonElement | undefined = $state();
  let searchField: HTMLInputElement | undefined = $state();
  let popup: HTMLDivElement | null = $state(null);
  let typed = "";
  let typedAt = 0;

  const selected = $derived(options.find((option) => option.value === value));
  const withSearch = $derived(searchable === "auto" ? options.length > AUTO_SEARCH_THRESHOLD : searchable);
  const visible = $derived.by(() => {
    const needle = normalise(query.trim());
    return needle ? options.filter((option) => normalise(option.label).includes(needle)) : options;
  });
  const activeId = $derived(open && active >= 0 ? optionId(active) : undefined);

  /** The nearest enabled option from `from`, walking in `step` direction; -1 when there is none. */
  function enabledFrom(from: number, step: 1 | -1): number {
    for (let index = from; index >= 0 && index < visible.length; index += step) {
      if (!visible[index].disabled) return index;
    }
    return -1;
  }

  function highlight(index: number) {
    if (index < 0) return;
    active = index;
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  async function show(start: "selected" | "first" | "last" = "selected") {
    if (disabled || open) return;
    query = "";
    open = true;
    await tick();
    if (withSearch) searchField?.focus();
    const current = selected ? visible.indexOf(selected) : -1;
    if (start === "last") highlight(enabledFrom(visible.length - 1, -1));
    else highlight(start === "selected" && current >= 0 ? current : enabledFrom(0, 1));
  }

  function close() {
    if (!open) return;
    // The search field goes away with the list; without this the focus would
    // fall back to <body> and the next Tab would start from the top of the
    // page. After a click elsewhere it is already where the user put it.
    const restore = popup?.contains(document.activeElement);
    open = false;
    active = -1;
    if (restore) trigger?.focus();
  }

  function pick(option: SelectOption<T>) {
    if (option.disabled) return;
    value = option.value;
    onChange?.(option.value);
    close();
  }

  function typeAhead(letter: string) {
    const now = Date.now();
    typed = now - typedAt > TYPEAHEAD_RESET_MS ? letter : typed + letter;
    typedAt = now;
    const needle = normalise(typed);
    const match = visible.findIndex((option) => !option.disabled && normalise(option.label).startsWith(needle));
    if (match === -1) return;
    if (open) highlight(match);
    else pick(visible[match]);
  }

  /** Shared by the trigger and the search field — whichever holds focus while the list is open. */
  function handleListKey(event: KeyboardEvent): boolean {
    switch (event.key) {
      case "ArrowDown":
        highlight(enabledFrom(active + 1, 1));
        return true;
      case "ArrowUp":
        highlight(enabledFrom(active - 1, -1));
        return true;
      case "Home":
        highlight(enabledFrom(0, 1));
        return true;
      case "End":
        highlight(enabledFrom(visible.length - 1, -1));
        return true;
      case "Enter":
        if (active >= 0) pick(visible[active]);
        return true;
      case "Tab":
        // Not prevented: the list closes and Tab carries on from the trigger.
        close();
        return false;
      default:
        return false;
    }
  }

  function handleTriggerKey(event: KeyboardEvent) {
    const printable = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        void show(event.key === "ArrowUp" && !selected ? "last" : "selected");
      } else if (printable) typeAhead(event.key);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (active >= 0) pick(visible[active]);
    } else if (handleListKey(event)) event.preventDefault();
    else if (printable) typeAhead(event.key);
  }

  function handleSearchKey(event: KeyboardEvent) {
    // Home / End belong to the text caret while a query is being typed.
    if ((event.key === "Home" || event.key === "End") && query) return;
    if (handleListKey(event)) event.preventDefault();
  }
</script>

<button
  bind:this={trigger}
  type="button"
  role="combobox"
  {id}
  {disabled}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? listId : undefined}
  aria-activedescendant={withSearch ? undefined : activeId}
  aria-invalid={invalid || undefined}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  class={`relative inline-flex cursor-pointer items-center gap-2 text-left ${SIZE_CLASS[size]} ${invalid ? INPUT_INVALID_CLASS : ""} ${className}`
    .replace(/\s+/g, " ")
    .trim()}
  onclick={() => (open ? close() : void show())}
  onkeydown={handleTriggerKey}
>
  {#if selected?.icon}<Icon icon={selected.icon} size={14} class="shrink-0 text-text-secondary" />{/if}
  <span class={`min-w-0 flex-1 truncate ${selected ? "" : "text-text-muted"}`}>
    {selected?.label ?? placeholder ?? ""}
  </span>
  <Icon
    icon={ChevronRightIcon}
    size={14}
    class={`pointer-events-none absolute right-1.5 text-text-muted transition-transform duration-fast ${open ? "-rotate-90" : "rotate-90"}`}
  />
</button>

<Popover {open} anchor={trigger} onClose={close} bind:ref={popup} matchWidth class="flex flex-col overflow-hidden">
  {#if withSearch}
    <div class="relative shrink-0 border-b border-border">
      <Icon icon={SearchIcon} size={13} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        bind:this={searchField}
        bind:value={query}
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-label={t("ui.select.search")}
        placeholder={t("ui.select.search")}
        class="h-8 w-full border-0 bg-transparent pl-8 pr-2.5 text-body-sm text-text placeholder:text-text-muted focus:outline-hidden"
        oninput={() => highlight(enabledFrom(0, 1))}
        onkeydown={handleSearchKey}
      />
    </div>
  {/if}
  <!-- Options are picked on click and never take focus (`mousedown` is
       cancelled), so the trigger or the search field keeps the keyboard. -->
  <div
    id={listId}
    role="listbox"
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledby}
    class="min-h-0 flex-1 overflow-y-auto p-1"
  >
    {#each visible as option, index (index)}
      {#if option.group && option.group !== visible[index - 1]?.group}
        <div role="presentation" class="px-2.5 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-text-muted">
          {option.group}
        </div>
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        id={optionId(index)}
        role="option"
        tabindex={-1}
        aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        class={`flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-body-sm font-medium ${
          option.disabled
            ? "cursor-not-allowed text-text-muted opacity-50"
            : `cursor-pointer ${index === active ? "bg-surface-hover text-text" : "text-text-secondary"}`
        }`}
        onmousedown={(event) => event.preventDefault()}
        onmousemove={() => {
          if (!option.disabled && active !== index) active = index;
        }}
        onclick={() => pick(option)}
      >
        {#if option.icon}<Icon icon={option.icon} size={14} class="shrink-0" />{/if}
        <span class="min-w-0 flex-1">
          <span class="block truncate">{option.label}</span>
          {#if option.hint}<span class="block truncate text-caption font-normal text-text-muted">{option.hint}</span>{/if}
        </span>
        {#if option.value === value}<Icon icon={CheckIcon} size={13} class="shrink-0 text-primary" />{/if}
      </div>
    {:else}
      <div class="px-2.5 py-2 text-body-sm text-text-muted">{t("ui.select.noResults")}</div>
    {/each}
  </div>
</Popover>
