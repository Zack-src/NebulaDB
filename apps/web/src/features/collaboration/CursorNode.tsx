import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface CursorNodeData {
  name: string;
  color: string;
  [key: string]: unknown;
}

export type CursorNodeType = Node<CursorNodeData, "cursor">;

/**
 * Remote user's live cursor — a plain React Flow node so it inherits pan/zoom for free instead of needing manual screen-space math.
 * Never draggable/selectable/deletable.
 *
 * The wrapper can't be a true `width: 0, height: 0` box: React Flow only marks a node as "measured" (and lifts its
 * `visibility: hidden` placeholder) once its ResizeObserver entry reports a *non-zero* width and height — see
 * `updateNodeInternals`'s `dimensions.width && dimensions.height` guard. A zero-size node never passes that check, so
 * it would stay invisible forever regardless of any other participant's cursor position. 1x1 is close enough to
 * zero to be visually inert while still satisfying the guard; the SVG/label are positioned absolutely over it anyway.
 */
function CursorNodeImpl({ data }: NodeProps<CursorNodeType>) {
  return (
    <div style={{ pointerEvents: "none", position: "relative", width: 1, height: 1 }}>
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: "absolute", top: -1, left: -1 }}>
        <path
          d="M1 1 L1 14.5 L5 11 L7.8 16.5 L10 15.4 L7.2 10 L13 10 Z"
          fill={data.color}
          stroke="white"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute left-[15px] top-[15px] whitespace-nowrap rounded-full px-[7px] py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
        style={{ background: data.color }}
      >
        {data.name}
      </span>
    </div>
  );
}

export const CursorNode = memo(CursorNodeImpl);
