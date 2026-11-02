import type { EditorView } from "@codemirror/view";
import { loadViewport, saveViewport } from "@/utils/preferences";

/**
 * Going from one variant to another keeps the view: the canvas stays where it
 * was (same pan and zoom) and so does the DBML text (same top line, same
 * cursor), and so does the open tab. A variant is a copy of its original, so
 * tables sit at the same places and the same lines hold the same things —
 * landing on a freshly fitted canvas and the top of the code would only make
 * the reader find their place again, once per client.
 *
 * Nothing here is stored: a switch captures the view of the editor being left
 * and the next editor mounted for the target takes it, once.
 */

export interface DbmlViewSnapshot {
  /** The 1-based line at the top of the editor. */
  topLine: number;
  /** How far down that line the editor is scrolled (px), so a long line is not jumped to its start. */
  topOffset: number;
  scrollLeft: number;
  /** 1-based line and 0-based column of the cursor's head and anchor. */
  anchor: { line: number; column: number };
  head: { line: number; column: number };
  focused: boolean;
}

interface Carry {
  targetProjectId: string;
  capturedAt: number;
  dbml: DbmlViewSnapshot | null;
  /** The next open keeps the workspace tab instead of going back to the schema. */
  keepTab: boolean;
}

/** A capture nobody picks up (the switch failed, the project was not allowed) must not apply to a later, unrelated open. */
const CARRY_MAX_AGE_MS = 15_000;

let live: EditorView | null = null;
let pending: Carry | null = null;

/** The DBML editor currently on screen, if any. */
export function registerDbmlView(view: EditorView | null): void {
  live = view;
}

function position(view: EditorView, offset: number): { line: number; column: number } {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number, column: offset - line.from };
}

function snapshotDbml(view: EditorView): DbmlViewSnapshot {
  const scrollTop = view.scrollDOM.scrollTop;
  const top = view.lineBlockAtHeight(scrollTop + view.documentTop - view.scrollDOM.getBoundingClientRect().top);
  const topLine = view.state.doc.lineAt(top.from).number;
  const { anchor, head } = view.state.selection.main;
  return {
    topLine,
    topOffset: Math.max(0, scrollTop - top.top),
    scrollLeft: view.scrollDOM.scrollLeft,
    anchor: position(view, anchor),
    head: position(view, head),
    focused: view.hasFocus,
  };
}

/**
 * Called when the person picks another variant: keeps the canvas pan and zoom (copied to the target, which stores
 * them per project), and sets aside where the DBML editor is for the one that mounts next.
 */
export function carryViewToProject(fromProjectId: string, toProjectId: string, userId: string): void {
  const viewport = loadViewport(fromProjectId, userId);
  if (viewport) saveViewport(toProjectId, userId, viewport);
  pending = {
    targetProjectId: toProjectId,
    capturedAt: Date.now(),
    dbml: live ? snapshotDbml(live) : null,
    keepTab: true,
  };
}

function current(projectId: string): Carry | null {
  if (!pending) return null;
  const carry = pending;
  if (carry.targetProjectId !== projectId || Date.now() - carry.capturedAt > CARRY_MAX_AGE_MS) return null;
  return carry;
}

/** For the router, as the target opens: should the workspace tab stay as it is? Consumed. */
export function takeKeepTab(projectId: string): boolean {
  const carry = current(projectId);
  if (!carry?.keepTab) return false;
  carry.keepTab = false;
  return true;
}

/** For the DBML editor of the target, once its document is in: where to put the view. Consumed. */
export function takeDbmlView(projectId: string): DbmlViewSnapshot | null {
  const carry = current(projectId);
  if (!carry) return null;
  const snapshot = carry.dbml;
  carry.dbml = null;
  if (!carry.keepTab) pending = null;
  return snapshot;
}

/** Puts a captured view into `view`, lines clamped to the document it now holds. */
export function restoreDbmlView(view: EditorView, snapshot: DbmlViewSnapshot): void {
  const doc = view.state.doc;
  const offsetOf = (at: { line: number; column: number }) => {
    const line = doc.line(Math.min(Math.max(1, at.line), doc.lines));
    return line.from + Math.min(at.column, line.length);
  };
  view.dispatch({ selection: { anchor: offsetOf(snapshot.anchor), head: offsetOf(snapshot.head) } });
  // Scrolling needs the editor laid out: after a frame, and again once the line heights are measured.
  const apply = () => {
    const topPos = offsetOf({ line: snapshot.topLine, column: 0 });
    view.scrollDOM.scrollTop = view.lineBlockAt(topPos).top + snapshot.topOffset;
    view.scrollDOM.scrollLeft = snapshot.scrollLeft;
  };
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  if (snapshot.focused) view.focus();
}
