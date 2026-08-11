import { useEffect, useState } from "react";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness.js";
import {
  type Project,
  getEnumsMap,
  getMetaMap,
  getRefsMap,
  getStickyNotesMap,
  getTablesMap,
  getZonesMap,
  readProjectFromDoc,
} from "@athanordb/shared";
import { connectProject, type ConnectionStatus } from "@/features/collaboration/yjsClient";

export interface ProjectDocHandle {
  project: Project | null;
  doc: Y.Doc | null;
  undoManager: Y.UndoManager | null;
  awareness: Awareness | null;
  connection: ConnectionStatus;
}

/** Connects to the project's Yjs room over WS and keeps `project` in sync with live doc state. */
export function useProjectDoc(projectId: string, fallbackName: string, user: string): ProjectDocHandle {
  const [project, setProject] = useState<Project | null>(null);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    // Reset while (re)connecting to a different project/user — deliberate,
    // not the "derive state from props" anti-pattern the lint rule targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProject(null);
    setDoc(null);
    setUndoManager(null);
    setAwareness(null);
    setConnection("connecting");

    const conn = connectProject(projectId, user, setConnection);
    const refresh = () => setProject(readProjectFromDoc(conn.doc, projectId, fallbackName));
    const editableMaps = [
      getTablesMap(conn.doc),
      getRefsMap(conn.doc),
      getEnumsMap(conn.doc),
      getZonesMap(conn.doc),
      getStickyNotesMap(conn.doc),
    ];
    const maps = [...editableMaps, getMetaMap(conn.doc)];
    maps.forEach((m) => m.observe(refresh));
    conn.doc.on("update", refresh);
    refresh();

    // Only tracks local edits (default trackedOrigins is `{null}`); remote
    // updates arrive tagged with `yjsClient`'s remote-origin symbol, so each
    // user's undo stack stays their own instead of undoing peers' changes.
    const manager = new Y.UndoManager(editableMaps);
    setDoc(conn.doc);
    setUndoManager(manager);
    setAwareness(conn.awareness);

    return () => {
      conn.doc.off("update", refresh);
      maps.forEach((m) => m.unobserve(refresh));
      manager.destroy();
      conn.disconnect();
    };
    // fallbackName deliberately excluded: it's only a fallback for a doc that
    // hasn't set its meta.name yet, not a connection parameter — it shouldn't
    // force a reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user]);

  return { project, doc, undoManager, awareness, connection };
}
