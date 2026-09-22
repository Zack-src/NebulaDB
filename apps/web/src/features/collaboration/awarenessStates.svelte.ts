import type { Awareness } from "y-protocols/awareness.js";
import type { AwarenessState } from "@/features/collaboration/yjsClient";

/** Live map of remote clients' awareness state (cursor, user info), excluding the local client. */
export function useAwarenessStates(awareness: () => Awareness | null): { readonly states: Map<number, AwarenessState> } {
  let states = $state.raw<Map<number, AwarenessState>>(new Map());
  // Mirrors `states.size` outside the reactive graph: reading `states` itself
  // from inside the effect below would make the effect depend on what it writes.
  let remoteCount = 0;

  $effect(() => {
    const current = awareness();
    if (!current) {
      // Reset while (re)connecting.
      remoteCount = 0;
      states = new Map();
      return;
    }
    const refresh = () => {
      const next = new Map<number, AwarenessState>();
      current.getStates().forEach((state, clientId) => {
        if (clientId === current.clientID) return;
        if (state && typeof state === "object" && "user" in state) next.set(clientId, state as AwarenessState);
      });
      // Yjs fires "change" for the *local* client's own awareness updates
      // too — including the cursor position this same tab broadcasts on
      // every animation frame while the mouse moves (see
      // `collaboratorCursor.ts`). With nobody else in the project, handing
      // out a fresh empty map every time would notify every reader on every
      // one of those frames for nothing. Solo work is the common case, so no
      // new object when the set of remote collaborators is still empty.
      if (remoteCount === 0 && next.size === 0) return;
      remoteCount = next.size;
      states = next;
    };
    current.on("change", refresh);
    refresh();
    return () => current.off("change", refresh);
  });

  return {
    get states() {
      return states;
    },
  };
}

export interface RemoteSelector {
  name: string;
  color: string;
}

/**
 * Live map of tableId -> the remote collaborators who currently have that
 * table selected, Figma-style.
 *
 * Derived from the same awareness states as `useAwarenessStates`, but this
 * only notifies its readers when a *selection* actually changes — not on every
 * cursor-move-driven awareness update, which fires many times a second per
 * peer. Without the fingerprint check below, every table node reading this map
 * would update on every remote mouse frame.
 */
export function useRemoteSelections(awareness: () => Awareness | null): {
  readonly selections: Map<string, RemoteSelector[]>;
} {
  let selections = $state.raw<Map<string, RemoteSelector[]>>(new Map());
  let fingerprint = "";

  $effect(() => {
    const current = awareness();
    if (!current) {
      fingerprint = "";
      selections = new Map();
      return;
    }
    const refresh = () => {
      const next = new Map<string, RemoteSelector[]>();
      current.getStates().forEach((state, clientId) => {
        if (clientId === current.clientID) return;
        const s = state as AwarenessState | undefined;
        if (!s?.user || !s.selection?.length) return;
        const selector: RemoteSelector = { name: s.user.name, color: s.user.color };
        for (const tableId of s.selection) {
          const list = next.get(tableId);
          if (list) list.push(selector);
          else next.set(tableId, [selector]);
        }
      });
      // Sorted so key order never causes a false diff.
      const nextFingerprint = Array.from(next.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tableId, selectors]) => `${tableId}:${selectors.map((sel) => sel.name + sel.color).join(",")}`)
        .join("|");
      if (nextFingerprint === fingerprint) return;
      fingerprint = nextFingerprint;
      selections = next;
    };
    current.on("change", refresh);
    refresh();
    return () => current.off("change", refresh);
  });

  return {
    get selections() {
      return selections;
    },
  };
}
