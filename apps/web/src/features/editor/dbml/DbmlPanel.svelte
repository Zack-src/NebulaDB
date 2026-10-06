<script lang="ts" module>
  /** How long a plugin's status line stays up before it clears itself. */
  const PLUGIN_MESSAGE_MS = 4000;
  /** The format name, not prose — never translated. */
  const DBML_LABEL = "DBML";

  export interface DbmlErrorPos {
    line: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { Project } from "@nebuladb/shared";
  import { projectToDbml } from "@nebuladb/dbml-engine";
  import { ChevronLeftIcon, CodeIcon, LayoutGridIcon, SettingsIcon } from "@/components/icons/Icons";
  import { SwapHorizontalIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import DbmlEditor from "@/features/editor/dbml/DbmlEditor/DbmlEditor.svelte";
  import type { PluginEditorCommand, SyncIndicator } from "@/features/editor/dbml/DbmlEditor/types";
  import { behaviourPrefs } from "@/features/editor/dbml/DbmlEditor/behaviourPrefs.svelte";
  import { useEditorCommands } from "@/features/plugins/plugins.svelte";
  import type { EditorCommandResult } from "@/features/plugins/types";
  import type { SchemaFinding, ServerProblem } from "@/features/editor/dbml/lint";
  import { dbmlSignature } from "@/features/editor/dbml/symbols";
  import { createBufferSync } from "@/features/editor/dbml/bufferSync";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { ApiError } from "@/services/ApiError";
  import type { TranslationKeyOf } from "@/types";
  import { exportDbml, importSource } from "@/services/projectsApi";
  import { time } from "@/utils/perfMonitor";
  import { useFlashMessage } from "@/hooks/flashMessage.svelte";
  import {
    DBML_PANEL_WIDTH_DEFAULT,
    DBML_PANEL_WIDTH_MAX,
    DBML_PANEL_WIDTH_MIN,
    loadDbmlPanelWidth,
    saveDbmlPanelWidth,
  } from "@/utils/preferences";

  let props: {
    project: Project;
    projectId: string;
    /** True for a `view` grant — the buffer still shows the live schema, but nothing typed into it is sent. */
    readOnly?: boolean;
    onClose: () => void;
    onConvertTypes?: () => void;
    scrollToTable?: { tableName: string; requestId: number } | null;
    onNavigateToCanvas?: (target: { tableName: string; fieldName?: string }) => void;
    /** The schema linter's findings, underlined in the buffer. */
    findings?: readonly SchemaFinding[];
    /** Lower-case names of the tables a lock forbids this user to alter. */
    frozenTables?: ReadonlySet<string>;
    onLockedEdit?: (tableName: string) => void;
  } = $props();

  const { t } = useTranslation();
  const readOnly = $derived(props.readOnly ?? false);
  const editorCommands = useEditorCommands(() => props.projectId);
  const flashMessage = useFlashMessage(PLUGIN_MESSAGE_MS);

  function serializeInitial(): string {
    try {
      return time("dbml.serialize", () => projectToDbml(untrack(() => props.project)));
    } catch {
      return "";
    }
  }

  let text = $state(serializeInitial());
  /**
   * Two kinds of error live side by side here, and they are stored differently
   * on purpose. `error` holds a message the *server* wrote (a DBML diagnostic
   * naming the offending token) which is passed through verbatim. `errorKey`
   * holds one of ours, kept as a key so it re-renders in the user's language
   * when they switch locale rather than freezing in whichever was active when
   * it was raised.
   */
  let error = $state<string | null>(null);
  let errorKey = $state<TranslationKeyOf | null>(null);
  let problem = $state.raw<ServerProblem | null>(null);
  // Whether the red message itself is collapsed — the toggle button that
  // controls it stays visible either way, so there's still a way to bring it
  // back once hidden. A newly-reported problem resets it: only the deliberate
  // "hide" toggle on an *unchanged* problem keeps it collapsed.
  const problemIdentity = $derived(error ?? errorKey ?? null);
  let errorHiddenFor = $state<string | null>(null);
  const errorHidden = $derived(problemIdentity !== null && errorHiddenFor === problemIdentity);
  let panelWidth = $state(loadDbmlPanelWidth());
  let isResizing = $state(false);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Bumped whenever the buffer/document arbitration may have a different
  // answer than last time (an import settled, a deferral ran out) — the
  // controller itself is plain, non-reactive state.
  let syncTick = $state(0);
  let syncState = $state<SyncIndicator["state"]>("synced");
  const syncIndicator = $derived<SyncIndicator>({ state: syncState, line: problem?.line });
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const sync = createBufferSync<{ keepalive?: boolean }>({
    initialText: untrack(() => text),
    signatureOf: (source) => time("dbml.signature", () => dbmlSignature(source)),
    send: (source, baseline, options) => importSource(props.projectId, source, undefined, baseline, options),
    onSettled: (err) => {
      syncTick++;
      syncState = sync.status;
      reportImportOutcome(err);
    },
  });
  let editor: DbmlEditor | undefined = $state();

  function startResizing(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    const startX = event.clientX;
    const startWidth = panelWidth;

    const clamp = (deltaX: number) => {
      const maxWidth = Math.min(DBML_PANEL_WIDTH_MAX, window.innerWidth - 100);
      return Math.max(DBML_PANEL_WIDTH_MIN, Math.min(maxWidth, startWidth + deltaX));
    };

    const onMouseMove = (moveEvent: MouseEvent) => (panelWidth = clamp(moveEvent.clientX - startX));
    const onMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      isResizing = false;
      saveDbmlPanelWidth(clamp(upEvent.clientX - startX));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleDoubleClickResizer() {
    panelWidth = DBML_PANEL_WIDTH_DEFAULT;
    saveDbmlPanelWidth(DBML_PANEL_WIDTH_DEFAULT);
  }

  // Sync live project changes (e.g. node/ref deletions or modifications) into DBML text.
  // `projectToDbml` re-serializes the whole schema in its own canonical layout, so
  // adopting it blindly would throw away the buffer's formatting and comments a few
  // hundred ms after every edit. `bufferSync.ts` decides when the document may
  // replace the buffer — never while the buffer is the newer of the two.
  $effect(() => {
    const project = props.project;
    const projectId = props.projectId;
    void syncTick;

    const offer = (dbml: string) => {
      const { adopt, retryInMs } = sync.offerDocument(dbml);
      if (adopt !== undefined) text = adopt;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = retryInMs === undefined ? null : setTimeout(() => syncTick++, retryInMs);
    };

    try {
      offer(time("dbml.serialize", () => projectToDbml(project)));
    } catch (err) {
      // Background reconciliation, not a user action — log it and retry via
      // the server's own serializer rather than surfacing it as an error.
      console.error("[dbml] client-side re-serialization failed, falling back to server export:", err);
      exportDbml(projectId)
        .then(offer)
        .catch((fallbackErr: unknown) => console.error("[dbml] fallback export also failed:", fallbackErr));
    }
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };
  });

  function clearErrors() {
    error = null;
    errorKey = null;
    problem = null;
  }

  function reportImportOutcome(err: unknown) {
    if (err === null) return clearErrors();
    const parseFailure = err instanceof ApiError && typeof err.details.line === "number";
    if (parseFailure) {
      // A real DBML validation problem — actionable, stays visible next
      // to the editor (not a transport/sync failure). The server's own
      // diagnostic is used verbatim: it names the offending token.
      const { line, column, endLine, endColumn } = (err as ApiError).details as Record<string, number>;
      error = (err as ApiError).message;
      problem = { message: (err as ApiError).message, line, column, endLine, endColumn };
      return;
    }
    if (err instanceof ApiError && err.code === "TABLE_LOCKED") {
      // The buffer changes a locked table: nothing was applied, and unlike a
      // dropped connection this *is* something the user can fix — by putting
      // that table back the way it was.
      error = describeApiError(err, t);
      problem = null;
      return;
    }
    // Rejected for some other reason (permissions, a malformed request,
    // a dropped connection) — not something typing more DBML fixes, so
    // it isn't shown as an editor error; logged for debugging instead.
    console.error("[dbml] sync rejected:", err);
    clearErrors();
  }

  function applyNow(options?: { keepalive?: boolean }, force = false) {
    if (readOnly) return;
    sync.flush(options, force);
  }

  // A rename (or any edit) sits in the browser for the configured sync delay
  // before it's actually POSTed (indefinitely with the delay set to "manual") — closing the panel, navigating away, or
  // reloading inside that window would otherwise drop the edit on the floor.
  // Flush whatever's still pending instead of discarding it.
  $effect(() => {
    const flushPending = () => {
      if (debounce) clearTimeout(debounce);
      debounce = null;
      // `keepalive` lets this survive the tab actually closing/reloading
      // (a plain fetch gets aborted with the document); a same-tab route
      // change or panel close doesn't need it but it's harmless either way.
      // Forced: the page is going away, there is no waiting for an import
      // already in flight to be answered.
      applyNow({ keepalive: true }, true);
    };
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  });

  function handleChange(value: string) {
    text = value;
    sync.edit(value);
    clearErrors();
    syncState = "pending";
    if (debounce) clearTimeout(debounce);
    debounce = null;
    // `0` is "only when I ask" (Ctrl+S); leaving the panel still flushes.
    const delay = behaviourPrefs.syncDelayMs;
    if (delay === 0) return;
    debounce = setTimeout(() => {
      debounce = null;
      applyNow();
    }, delay);
  }

  /** Ctrl+S — skip the debounce and push the current buffer immediately. */
  function handleSave() {
    if (debounce) clearTimeout(debounce);
    debounce = null;
    applyNow();
  }

  /** Plugin editor commands, adapted to what `DbmlEditor` needs (text in, text out). */
  const pluginCommands = $derived(
    editorCommands.list.map((command): PluginEditorCommand => ({
      key: command.key,
      label: command.contribution.label,
      detail: command.source === "user" ? command.plugin.name : undefined,
      shortcut: command.contribution.shortcut,
      run: async (input) => (await command.run(input)) as EditorCommandResult,
    })),
  );

  function handlePluginMessage(message: string, isError?: boolean) {
    flashMessage.flash(isError ? t("plugins.errorPrefix", { message }) : message);
  }
</script>

<div class="relative flex shrink-0 flex-col border-r border-border bg-surface nokey" style:width="{panelWidth}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={`absolute bottom-0 right-[-4px] top-0 z-20 w-2 cursor-col-resize transition-colors duration-150 ${isResizing ? "bg-primary" : "hover:bg-primary"}`}
    onmousedown={startResizing}
    ondblclick={handleDoubleClickResizer}
    data-tooltip={t("dbml.resizeHint")}
  ></div>
  <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
    <Icon icon={CodeIcon} size={14} class="text-text-muted" />
    <span class="text-[13px] font-semibold text-text">{DBML_LABEL}</span>
    {#if flashMessage.message}<span class="truncate text-[11.5px] text-text-muted">{flashMessage.message}</span>{/if}
    <span class="ml-auto"></span>
    {#if props.onConvertTypes}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={props.onConvertTypes}
        aria-label={t("editor.convertTypes")}
        data-tooltip={t("editor.convertTypes")}><Icon icon={SwapHorizontalIcon} size={14} /></Button
      >
    {/if}
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => editor?.openPalette("symbols")}
      data-tooltip={t("dbml.goToSymbol")}
    >
      <Icon icon={LayoutGridIcon} size={14} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={() => editor?.openPalette("commands")}
      data-tooltip={t("dbml.commandPalette")}
    >
      <Icon icon={SettingsIcon} size={14} />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => editor?.format()} data-tooltip={t("dbml.formatDocument")}>
      {t("dbml.format")}
    </Button>
    <Button variant="ghost" size="icon" onclick={props.onClose} data-tooltip={t("dbml.collapse")}>
      <Icon icon={ChevronLeftIcon} size={16} />
    </Button>
  </div>
  <div class="min-h-0 flex-1">
    <DbmlEditor
      bind:this={editor}
      value={text}
      {readOnly}
      onChange={handleChange}
      onSave={handleSave}
      {problem}
      findings={props.findings}
      frozenTables={props.frozenTables}
      onLockedEdit={props.onLockedEdit}
      syncIndicator={readOnly ? undefined : syncIndicator}
      scrollToTable={props.scrollToTable}
      onNavigateToCanvas={props.onNavigateToCanvas}
      {pluginCommands}
      onPluginMessage={handlePluginMessage}
    />
  </div>
  {#if error || errorKey}
    <div class="m-2">
      <button
        type="button"
        onclick={() => (errorHiddenFor = errorHidden ? null : problemIdentity)}
        class="text-[11px] font-medium text-text-muted underline decoration-dotted hover:text-text"
      >
        {t(errorHidden ? "dbml.showParseError" : "dbml.hideParseError")}
      </button>
      {#if !errorHidden}
        <ErrorText>
          {errorKey
            ? t(errorKey)
            : problem
              ? `${t("dbml.problemAt", { line: problem.line, column: problem.column ?? "" })} — ${error}`
              : error}
        </ErrorText>
      {/if}
    </div>
  {/if}
</div>
