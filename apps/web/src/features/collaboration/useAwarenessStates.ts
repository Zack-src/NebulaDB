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
      setStates(next);
    };
    awareness.on("change", refresh);
    refresh();
    return () => awareness.off("change", refresh);
  }, [awareness]);

  return states;
}
