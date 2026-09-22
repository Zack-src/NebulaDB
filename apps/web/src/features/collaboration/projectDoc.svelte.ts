import { untrack } from "svelte";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness.js";
import {
  type Project,
  getEnumsMap,
  getRefsMap,
  getStickyNotesMap,
  getTablesMap,
  getZonesMap,
  readProjectFromDoc,
} from "@athanordb/shared";
import { connectProject, type ConnectionStatus } from "@/features/collaboration/yjsClient";
import { time } from "@/utils/perfMonitor";

export interface ProjectDocHandle {
  readonly project: Project | null;
  readonly doc: Y.Doc | null;
  readonly undoManager: Y.UndoManager | null;
  readonly awareness: Awareness | null;
  readonly connection: ConnectionStatus;
}

/** Connects to the project's Yjs room over WS and keeps `project` in sync with live doc state. */
export function useProjectDoc(
  projectId: () => string,
  fallbackName: () => string,
  user: () => string,
): ProjectDocHandle {
  let project = $state.raw<Project | null>(null);
  let doc = $state.raw<Y.Doc | null>(null);
  let undoManager = $state.raw<Y.UndoManager | null>(null);
  let awareness = $state.raw<Awareness | null>(null);
  let connection = $state<ConnectionStatus>("connecting");

  $effect(() => {
    const id = projectId();
    const userName = user();
    // `fallbackName` deliberately not tracked: it's only a fallback for a doc
    // that hasn't set its meta.name yet, not a connection parameter — it
    // shouldn't force a reconnect.
    const name = untrack(fallbackName);

    // Reset while (re)connecting to a different project/user.
    project = null;
    doc = null;
    undoManager = null;
    awareness = null;
    connection = "connecting";
    const conn = connectProject(id, userName, (status) => {
      connection = status;
    });
    // Rebuilds the *whole* project (every table/field/ref/zone) from the Yjs
    // maps on every single doc update, local or remote — the classic
    // "recompute everything on every tiny change" hot path for a big schema
    // with several people editing at once. `readProjectFromDoc` keeps each
    // table object reference-stable when Yjs didn't touch it, which is what
    // every per-table cache downstream keys on.
    const refresh = () => time("doc.readProjectFromDoc", () => (project = readProjectFromDoc(conn.doc, id, name)));
    const editableMaps = [
      getTablesMap(conn.doc),
      getRefsMap(conn.doc),
      getEnumsMap(conn.doc),
      getZonesMap(conn.doc),
      getStickyNotesMap(conn.doc),
    ];
    conn.doc.on("update", refresh);
    refresh();
    // Only tracks local edits (default trackedOrigins is `{null}`); remote
    // updates arrive tagged with `yjsClient`'s remote-origin symbol, so each
    // user's undo stack stays their own instead of undoing peers' changes.
    const manager = new Y.UndoManager(editableMaps);
    doc = conn.doc;
    undoManager = manager;
    awareness = conn.awareness;
    return () => {
      conn.doc.off("update", refresh);
      manager.destroy();
      conn.disconnect();
    };
  });

  return {
    get project() {
      return project;
    },
    get doc() {
      return doc;
    },
    get undoManager() {
      return undoManager;
    },
    get awareness() {
      return awareness;
    },
    get connection() {
      return connection;
    },
  };
}
