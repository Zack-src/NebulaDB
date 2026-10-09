<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import type { DatabaseEngine } from "@nebuladb/shared";
  import { behaviourPrefs } from "@/features/editor/dbml/DbmlEditor/behaviourPrefs.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { columnCompletions, referencedTables, toSqlSchema, type SqlCatalogTable } from "./sqlCatalog";
  import {
    createSqlExtensions,
    sqlBracketsCompartment,
    sqlBracketsExtension,
    sqlCompletionCompartment,
    sqlCompletionExtension,
    sqlLanguage,
    sqlLanguageCompartment,
  } from "./sqlEditorSetup";

  /**
   * The statement field of the SQL console: the DBML editor's CodeMirror, cut
   * down to what one statement needs. Highlighting follows the engine's
   * dialect; completion offers its keywords and the tables and columns of
   * `catalog`.
   */
  let {
    value = $bindable(),
    engine,
    catalog,
    label,
    placeholder = "",
    compact = false,
    danger = false,
    onRun,
    onTablesReferenced,
  }: {
    value: string;
    engine: DatabaseEngine;
    catalog: readonly SqlCatalogTable[];
    /** The field's accessible name. */
    label: string;
    placeholder?: string;
    /** A shorter field — see `SqlPanel`. */
    compact?: boolean;
    /** Outlined as dangerous: what is typed here will be run in write mode. */
    danger?: boolean;
    /** Ctrl/Cmd+Enter. */
    onRun: () => void;
    /** The catalog's tables the statement names, whenever that may have changed — the caller decides what to load. */
    onTablesReferenced?: (tables: SqlCatalogTable[]) => void;
  } = $props();

  const { t } = useTranslation();
  let container: HTMLDivElement;
  let view: EditorView | null = null;

  function reportReferenced() {
    if (!view || !onTablesReferenced) return;
    const tables = referencedTables(view.state.doc.toString(), catalog);
    if (tables.length > 0) onTablesReferenced(tables);
  }

  // Owns the CodeMirror instance: created on mount, torn down on destroy.
  // Every callback reads the current props at call time.
  $effect(() => {
    const created = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: untrack(() => value),
        extensions: createSqlExtensions({
          engine: untrack(() => engine),
          compact: untrack(() => compact),
          autoComplete: untrack(() => behaviourPrefs.autoComplete),
          closeBrackets: untrack(() => behaviourPrefs.closeBrackets),
          placeholder: untrack(() => placeholder),
          label: () => label,
          onChange: (next) => {
            value = next;
            reportReferenced();
          },
          onRun: () => onRun(),
        }),
      }),
    });
    view = created;
    return () => {
      created.destroy();
      view = null;
    };
  });

  // A statement set from outside: a history entry recalled, "Voir les données".
  $effect(() => {
    const next = value;
    if (!view || view.state.doc.toString() === next) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: next.length } });
  });

  // The catalog arrives after the editor and keeps filling in (columns are
  // described as tables get named). Compared by content: in a project it is
  // rebuilt at every change of the schema, most of which change nothing here.
  const catalogSignature = $derived(JSON.stringify(catalog));
  $effect(() => {
    void catalogSignature;
    const labels = { table: t("dbadmin.sql.completion.table"), view: t("dbadmin.sql.completion.view") };
    const dialect = engine;
    const tables = untrack(() => catalog);
    const completion = {
      ...toSqlSchema(tables, dialect, labels),
      columns: (statement: string) => columnCompletions(statement, tables, dialect),
    };
    view?.dispatch({ effects: sqlLanguageCompartment.reconfigure(sqlLanguage(dialect, completion)) });
    untrack(reportReferenced);
  });

  // The DBML editor's own settings: what is switched off there is off here too.
  $effect(() => {
    const enabled = behaviourPrefs.autoComplete;
    view?.dispatch({ effects: sqlCompletionCompartment.reconfigure(sqlCompletionExtension(enabled)) });
  });
  $effect(() => {
    const enabled = behaviourPrefs.closeBrackets;
    view?.dispatch({ effects: sqlBracketsCompartment.reconfigure(sqlBracketsExtension(enabled)) });
  });
</script>

<div
  bind:this={container}
  class={`overflow-hidden rounded-md border transition-[border-color,box-shadow] duration-150 ease-out focus-within:ring-2 ${
    danger
      ? "border-danger/60 focus-within:ring-danger/25"
      : "border-border-control hover:border-border-strong focus-within:border-primary focus-within:ring-primary/25"
  }`}
></div>
