import { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow, type NodeChange } from "@xyflow/react";
import { DEFAULT_TABLE_HEIGHT, DEFAULT_TABLE_WIDTH } from "@/features/editor/edges/refGeometry";
import type { CanvasNode } from "@/types";

const JUMP_ZOOM = 1;
const JUMP_DURATION_MS = 300;

export interface CanvasSearchHandle {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  matchIds: string[];
  activeIndex: number;
  changeQuery: (query: string) => void;
  step: (delta: 1 | -1) => void;
  close: () => void;
}

/** True when the keystroke landed in a text field — a global shortcut must not steal it. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable ||
    Boolean(element.closest(".cm-editor, .nokey, [contenteditable='true']"))
  );
}

/**
 * Find-a-table-by-name (Ctrl/Cmd+F).
 *
 * Reads the node list through a ref updated in its own effect rather than
 * depending on it directly, so a remote collaborator's edit elsewhere on the
 * canvas can't yank the viewport back to the active match mid-search.
 */
export function useCanvasSearch(
  nodes: CanvasNode[],
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void,
): CanvasSearchHandle {
  const { setCenter } = useReactFlow();
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const jumpToTable = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((candidate) => candidate.id === id);
      if (!node) return;
      const width = node.measured?.width ?? DEFAULT_TABLE_WIDTH;
      const height = node.measured?.height ?? DEFAULT_TABLE_HEIGHT;
      setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: JUMP_ZOOM,
        duration: JUMP_DURATION_MS,
      });
      // Reuses the same select-change path a real click goes through, so the
      // match gets the ordinary selection outline instead of a bespoke "found"
      // style — one less visual language for a table to be in.
      onNodesChange(
        nodesRef.current
          .filter((candidate) => candidate.type === "table")
          .map((candidate) => ({ id: candidate.id, type: "select" as const, selected: candidate.id === id })),
      );
    },
    [setCenter, onNodesChange],
  );

  const changeQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      const needle = nextQuery.trim().toLowerCase();
      const matches = needle
        ? nodesRef.current
            .filter((node) => node.type === "table" && node.data.table.name.toLowerCase().includes(needle))
            .map((node) => node.id)
        : [];
      setMatchIds(matches);
      setActiveIndex(0);
      if (matches.length > 0) jumpToTable(matches[0]);
    },
    [jumpToTable],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (matchIds.length === 0) return;
      const next = (activeIndex + delta + matchIds.length) % matchIds.length;
      setActiveIndex(next);
      jumpToTable(matchIds[next]);
    },
    [matchIds, activeIndex, jumpToTable],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setMatchIds([]);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  return { open, setOpen, query, matchIds, activeIndex, changeQuery, step, close };
}
