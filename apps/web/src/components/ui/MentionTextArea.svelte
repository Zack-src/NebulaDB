<script lang="ts" module>
  export interface MentionCandidate {
    id: string;
    name: string;
  }

  /** `@` followed by what has been typed of a name, at the start of a word. */
  const OPEN_MENTION = /(^|\s)@([^\s@]{0,30})$/u;
  const SEARCH_DELAY_MS = 120;
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import { useEscapeKey } from "@/hooks/escapeKey.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import TextArea, { type TextAreaProps } from "./TextArea.svelte";

  /**
   * A comment composer where typing `@` offers people, filtered as you type.
   * Arrow keys move, Enter or Tab picks, Escape closes the list (and only the
   * list). The text holds the readable `@Name`; `picked` remembers which
   * account each picked name stands for, so the caller can store the account
   * and not only the name (`storeMentions`).
   *
   * Who is offered is not decided here: `search` answers, and the server only
   * ever lists accounts that can see the project.
   */
  let {
    value = $bindable(""),
    picked = $bindable<MentionCandidate[]>([]),
    search,
    onsubmit,
    ...rest
  }: Omit<TextAreaProps, "value"> & {
    value?: string;
    picked?: MentionCandidate[];
    search: (query: string, signal: AbortSignal) => Promise<MentionCandidate[]>;
    /** Ctrl/Cmd+Enter. */
    onsubmit?: () => void;
  } = $props();

  const { t } = useTranslation();
  const listId = `mention-list-${Math.random().toString(36).slice(2, 8)}`;
  let ref: HTMLTextAreaElement | null = $state(null);
  let candidates = $state.raw<MentionCandidate[]>([]);
  let open = $state(false);
  let active = $state(0);
  let anchorStart = 0;
  let timer: number | undefined;
  let controller: AbortController | undefined;

  useEscapeKey(
    () => open,
    () => close(),
  );
  onDestroy(() => {
    window.clearTimeout(timer);
    controller?.abort();
  });

  function close() {
    open = false;
    candidates = [];
    window.clearTimeout(timer);
    controller?.abort();
  }

  function track() {
    const caret = ref?.selectionStart ?? value.length;
    const match = OPEN_MENTION.exec(value.slice(0, caret));
    if (!match) return close();
    anchorStart = caret - match[2].length - 1;
    const query = match[2];
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      controller?.abort();
      const mine = (controller = new AbortController());
      try {
        const found = await search(query, mine.signal);
        if (mine.signal.aborted) return;
        candidates = found;
        active = 0;
        open = true;
      } catch {
        // Aborted by a newer keystroke, or offline: no list is better than a wrong one.
        if (!mine.signal.aborted) close();
      }
    }, SEARCH_DELAY_MS);
  }

  function pick(person: MentionCandidate) {
    const caret = ref?.selectionStart ?? value.length;
    value = `${value.slice(0, anchorStart)}@${person.name} ${value.slice(caret)}`;
    if (!picked.some((p) => p.id === person.id && p.name === person.name)) picked = [...picked, person];
    const next = anchorStart + person.name.length + 2;
    close();
    queueMicrotask(() => {
      ref?.focus();
      ref?.setSelectionRange(next, next);
    });
  }

  function onkeydown(event: KeyboardEvent) {
    if (open && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        active = (active + step + candidates.length) % candidates.length;
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(candidates[active]);
        return;
      }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onsubmit?.();
  }
</script>

<div class="relative min-w-0 flex-1">
  <TextArea
    bind:ref
    bind:value
    {...rest}
    class={`w-full ${rest.class ?? ""}`}
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listId}
    aria-activedescendant={open && candidates.length > 0 ? `${listId}-${active}` : undefined}
    oninput={track}
    onkeyup={(event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") track();
    }}
    onblur={close}
    {onkeydown}
  />
  {#if open}
    <ul
      id={listId}
      role="listbox"
      aria-label={t("mentions.listLabel")}
      class="absolute bottom-full left-0 z-10 m-0 mb-1 max-h-[160px] w-full list-none overflow-y-auto rounded-md border border-border-strong bg-surface-raised p-1 shadow-lg"
      data-testid="mention-list"
    >
      {#each candidates as person, index (person.id)}
        <li
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === active}
          class={`cursor-pointer truncate rounded-sm px-2 py-1 text-xs ${index === active ? "bg-primary-light text-primary" : "text-text hover:bg-surface-hover"}`}
          onmousedown={(event) => {
            // Keeps the focus in the text box: a blur would close the list before the pick.
            event.preventDefault();
            pick(person);
          }}
          onmousemove={() => (active = index)}
        >
          {person.name}
        </li>
      {:else}
        <li class="px-2 py-1 text-xs text-text-muted">{t("mentions.none")}</li>
      {/each}
    </ul>
  {/if}
</div>
