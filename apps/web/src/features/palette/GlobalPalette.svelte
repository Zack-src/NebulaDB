<script lang="ts">
  import { tick } from "svelte";
  import type { AdminConnectionSummary } from "@nebuladb/shared";
  import { autofocus } from "@/actions/autofocus";
  import type { AdminSection } from "@/features/admin/adminSections";
  import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
  import { openProjectSource } from "@/features/palette/openProjectSource";
  import {
    MIN_SERVER_QUERY,
    buildGroups,
    connectionEntries,
    flattenGroups,
    localTableEntries,
    navigationTargets,
    searchEntries,
    stepIndex,
    type PaletteAction,
    type PaletteEntry,
    type PaletteGroupId,
  } from "@/features/palette/paletteModel";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { listAdminConnections } from "@/services/dbAdminApi";
  import { searchSchemas, type SearchHit } from "@/services/searchApi";
  import type { ProjectSummary, Session } from "@/types";

  const DEBOUNCE_MS = 200;

  /**
   * Ctrl/Cmd+K from anywhere in the signed-in app: jump to a place, to a
   * table (the open project's first, instantly; then every project's, from
   * the server) or, for an instance administrator, to a connection's console.
   *
   * Left alone inside the DBML editor, where Ctrl+K is the prefix of its
   * chords (Ctrl+K Ctrl+U, Ctrl+K Ctrl+0…), and while a modal dialog is up.
   */
  let {
    session,
    project,
    onView,
    onAdmin,
    onProjectTab,
    onOpenProject,
  }: {
    session: Session;
    /** The project on screen, `null` on every other view. */
    project: ProjectSummary | null;
    onView: (view: "app" | "bases" | "settings") => void;
    onAdmin: (section: AdminSection, connectionId?: string) => void;
    onProjectTab: (tab: WorkspaceTab) => void;
    onOpenProject: (projectId: string, focus?: { tableName: string; fieldName?: string }) => void;
  } = $props();

  const { t } = useTranslation();
  let open = $state(false);
  let query = $state("");
  let index = $state(0);
  let hits = $state.raw<SearchHit[]>([]);
  let searching = $state(false);
  let searchFailed = $state(false);
  let connections = $state.raw<AdminConnectionSummary[]>([]);
  let list: HTMLDivElement | undefined = $state();
  let opener: HTMLElement | null = null;

  const needle = $derived(query.trim());
  const source = $derived.by(() => {
    const current = open ? openProjectSource.get() : null;
    return current && current.projectId === project?.id ? current : null;
  });
  const groups = $derived(
    open
      ? buildGroups({
          query,
          navigation: navigationTargets(session, project, t),
          localTables: source ? localTableEntries(query, source.projectId, source.tables()) : [],
          connections: session.isAdmin ? connectionEntries(query, connections) : [],
          hits: searchEntries(hits, source?.projectId ?? null),
        })
      : [],
  );
  const flat = $derived(flattenGroups(groups));
  const active = $derived(Math.max(0, Math.min(index, flat.length - 1)));
  const indexOf = (entry: PaletteEntry) => flat.indexOf(entry);

  const GROUP_LABEL: Record<PaletteGroupId, () => string> = {
    tables: () => (project ? t("palette.group.tables", { name: project.name }) : ""),
    go: () => t("palette.group.go"),
    connections: () => t("palette.group.connections"),
    search: () => t("palette.group.search"),
  };

  function openPalette() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query = "";
    index = 0;
    hits = [];
    open = true;
  }

  function close() {
    open = false;
    const target = opener;
    opener = null;
    // The element may have gone with the view the choice navigated away from.
    if (target && document.contains(target)) target.focus();
  }

  $effect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") {
        return;
      }
      if (open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".cm-editor")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // The browser would otherwise focus its own search bar; and a plugin's canvas shortcut must not also fire.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) openPalette();
    };
    // Capture phase on window and mounted with the shell, so it runs ahead of the canvas's plugin shortcuts.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // Connections are fetched when the palette opens — only ever for an instance administrator.
  $effect(() => {
    if (!open || !session.isAdmin) return;
    let live = true;
    listAdminConnections()
      .then((list) => {
        if (live) connections = list;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  // Debounced, abortable: a stale response can never replace a newer one.
  $effect(() => {
    const q = needle;
    if (!open || q.length < MIN_SERVER_QUERY) {
      hits = [];
      searching = false;
      searchFailed = false;
      return;
    }
    searching = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSchemas(q, controller.signal)
        .then((result) => {
          hits = result.hits;
          searchFailed = false;
        })
        .catch(() => {
          if (!controller.signal.aborted) searchFailed = true;
        })
        .finally(() => {
          if (!controller.signal.aborted) searching = false;
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  $effect(() => {
    void active;
    void tick().then(() => list?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  function run(action: PaletteAction) {
    switch (action.type) {
      case "view":
        onView(action.view);
        break;
      case "admin":
        onAdmin(action.section, action.connectionId);
        break;
      case "projectTab":
        onProjectTab(action.tab);
        break;
      case "table": {
        const here = openProjectSource.get();
        if (here && here.projectId === action.projectId) here.openTable(action.tableName, action.fieldName);
        else onOpenProject(action.projectId, { tableName: action.tableName, fieldName: action.fieldName });
        break;
      }
      case "project":
        onOpenProject(action.projectId);
        break;
    }
  }

  function commit(entry: PaletteEntry | undefined) {
    if (!entry) return;
    close();
    run(entry.action);
  }

  function onInputKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      index = stepIndex(active, event.key === "ArrowDown" ? 1 : -1, flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(flat[active]);
    }
    event.stopPropagation();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[12vh]"
    data-testid="global-palette"
    onmousedown={(event) => {
      if (event.target === event.currentTarget) close();
    }}
  >
    <div
      role="dialog"
      aria-label={t("palette.title")}
      class="flex h-fit max-h-[70vh] w-[92%] max-w-[600px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
    >
      <input
        use:autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls="global-palette-list"
        aria-activedescendant={flat.length > 0 ? `global-palette-option-${active}` : undefined}
        aria-label={t("palette.title")}
        autocomplete="off"
        spellcheck="false"
        value={query}
        placeholder={t("palette.placeholder")}
        oninput={(event) => {
          query = event.currentTarget.value;
          index = 0;
        }}
        onkeydown={onInputKeyDown}
        class="w-full border-b border-border bg-transparent px-3 py-2.5 text-[13px] text-text outline-hidden placeholder:text-text-muted"
      />
      <div bind:this={list} id="global-palette-list" role="listbox" class="min-h-0 flex-1 overflow-y-auto py-1">
        {#each groups as group (group.id)}
          <div
            role="presentation"
            class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
          >
            {GROUP_LABEL[group.id]()}
          </div>
          {#each group.entries as entry (entry.id)}
            {@const i = indexOf(entry)}
            <!-- Keys are handled on the combobox input, which keeps focus; the options are only clicked. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              id={`global-palette-option-${i}`}
              role="option"
              aria-selected={i === active}
              tabindex="-1"
              data-idx={i}
              onmouseenter={() => (index = i)}
              onclick={() => commit(entry)}
              class={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
                i === active ? "bg-primary text-white" : "text-text hover:bg-surface-hover"
              }`}
            >
              {#if entry.kind}
                <span
                  class={`shrink-0 rounded px-1 py-px text-[10px] uppercase tracking-wide ${
                    i === active ? "bg-white/20 text-white" : "bg-border text-text-muted"
                  }`}
                >
                  {t(`projects.globalSearch.kind.${entry.kind}`)}
                </span>
              {/if}
              <span class="truncate">{entry.label}</span>
              {#if entry.detail}
                <span class={`truncate text-[11px] ${i === active ? "text-white/70" : "text-text-muted"}`}
                  >{entry.detail}</span
                >
              {/if}
            </div>
          {/each}
        {/each}
        {#if flat.length === 0 && !searching}
          <div class="px-3 py-2 text-[12px] text-text-muted">{t("commandPalette.noMatch")}</div>
        {/if}
        {#if searching}
          <div class="px-3 py-2 text-[12px] text-text-muted">{t("common.loading")}</div>
        {:else if searchFailed}
          <div class="px-3 py-2 text-[12px] text-text-muted">{t("palette.searchFailed")}</div>
        {/if}
      </div>
    </div>
  </div>
{/if}
