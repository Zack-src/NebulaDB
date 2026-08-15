import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness.js";
import type { AwarenessState } from "@/features/collaboration/yjsClient";

export interface RemoteSelector {
  name: string;
  color: string;
}

/**
 * Live map of tableId -> the remote collaborators who currently have that
 * table selected, Figma-style.
 *
 * Derived from the same awareness states as `useAwarenessStates`, but this
 * hook only re-renders its subscribers when a *selection* actually changes —
 * not on every cursor-move-driven awareness update, which fires many times a
 * second per peer. Without the fingerprint check below, every `TableNode`
 * fed this map would re-render on every remote mouse frame.
 */
export function useRemoteSelections(awareness: Awareness | null): Map<string, RemoteSelector[]> {
  const [selections, setSelections] = useState<Map<string, RemoteSelector[]>>(new Map());
  const fingerprintRef = useRef<string>("");

  useEffect(() => {
    if (!awareness) {
      fingerprintRef.current = "";
      // Reset while (re)connecting — deliberate, not the "derive state from
      // props" anti-pattern the lint rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelections(new Map());
      return;
    }
    const refresh = () => {
      const next = new Map<string, RemoteSelector[]>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
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
      const fingerprint = Array.from(next.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tableId, selectors]) => `${tableId}:${selectors.map((sel) => sel.name + sel.color).join(",")}`)
        .join("|");
      if (fingerprint === fingerprintRef.current) return;
      fingerprintRef.current = fingerprint;
      setSelections(next);
    };
    awareness.on("change", refresh);
    refresh();
    return () => awareness.off("change", refresh);
  }, [awareness]);

  return selections;
}
