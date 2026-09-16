import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness.js";
import type { AwarenessState } from "@/features/collaboration/yjsClient";

/** Live map of remote clients' awareness state (cursor, user info), excluding the local client. */
export function useAwarenessStates(awareness: Awareness | null): Map<number, AwarenessState> {
  const [states, setStates] = useState<Map<number, AwarenessState>>(new Map());

  useEffect(() => {
    if (!awareness) {
      // Reset while (re)connecting — deliberate, not the "derive state from
      // props" anti-pattern the lint rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStates(new Map());
      return;
    }
    const refresh = () => {
      const next = new Map<number, AwarenessState>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        if (state && typeof state === "object" && "user" in state) next.set(clientId, state as AwarenessState);
      });
      // Yjs fires "change" for the *local* client's own awareness updates
      // too — including the cursor position this same tab broadcasts on
      // every animation frame while the mouse moves (see
      // `useCollaboratorCursor.ts`). With nobody else in the project, that
      // fired `setStates(new Map())` — a fresh object every time — on every
      // one of those frames, and `ProjectEditor` re-rendering cascaded into
      // `CanvasArea` (not memoized) on each one: measured as ~130
      // `canvas.render.update` commits over a single ~1.6s gesture that
      // touched none of this app's own code. Solo work is the common case,
      // so this one-line short-circuit — no new object when the set of
      // remote collaborators is still empty — is worth it on its own; a
      // real collaborator's cursor still updates every frame as before.
      setStates((prev) => (prev.size === 0 && next.size === 0 ? prev : next));
    };
    awareness.on("change", refresh);
    refresh();
    return () => awareness.off("change", refresh);
  }, [awareness]);

  return states;
}
