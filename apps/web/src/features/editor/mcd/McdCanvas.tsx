import { useMemo, useState } from "react";
import { ReactFlow, Background, BackgroundVariant, MiniMap, Panel, type Edge } from "@xyflow/react";
import { deriveMCD, type Project } from "@athanordb/shared";
import { loadGridStyle } from "@/utils/preferences";
import {
  CANVAS_VIEWPORT_PROPS,
  useMinimapPanProps,
  useSharedMinimapVisible,
  useSharedViewport,
} from "@/features/editor/canvas/canvasViewport";
import { CanvasZoomBar } from "@/features/editor/canvas/CanvasZoomBar";
import { EntityNode } from "./EntityNode";
import { AssociationNode } from "./AssociationNode";
import { McdEdge } from "./McdEdge";
import { McdToolbar } from "./McdToolbar";
import { buildMcdNodes } from "./mcdNodes";
import { computeMcdPositions } from "./mcdPositions";
import { mcdMinimapNodeColor } from "./mcdMinimapColor";
import { McdWarningsBanner } from "./McdWarningsBanner";
import { useMcdNodeDrag } from "./useMcdNodeDrag";
import { useMcdEdges } from "./useMcdEdges";
import type { EditorViewMode } from "./ViewModeToggle";

const nodeTypes = { entity: EntityNode, association: AssociationNode };
const edgeTypes = { mcd: McdEdge };

/**
 * A self-contained, read-only-*data* Merise MCD view, derived on the fly
 * from the live `Project` — never the other way around. Its own small
 * `ReactFlow` instance rather than a mode grafted onto `CanvasArea`: nothing
 * here writes to Yjs, is undoable through the app's own history, or
 * collaborative — but it reuses the same `CanvasZoomBar`/minimap/panel
 * chrome as the MLD canvas, and the viewport and its behavior (zoom bounds,
 * scroll/pan gestures) come from `canvasViewport.ts`, shared verbatim with
 * it — not just for less duplication: a `minZoom` mismatch between the two
 * would let one canvas clamp the other's saved zoom the moment it mounts,
 * corrupting the value they both read from.
 *
 * This component itself only derives the model and composes the pieces —
 * node/edge assembly (`mcdNodes.ts`, `useMcdEdges.ts`), drag/undo state
 * (`useMcdNodeDrag.ts`) and the toolbar (`McdToolbar.tsx`) each live in
 * their own file. Swapped in by `ProjectEditor` in place of `CanvasArea`.
 */
export function McdCanvas({
  project,
  projectId,
  viewportUserId,
  viewMode,
  onSetViewMode,
}: {
  project: Project;
  projectId: string;
  viewportUserId: string;
  viewMode: EditorViewMode;
  onSetViewMode: (mode: EditorViewMode) => void;
}) {
  const model = useMemo(() => deriveMCD(project), [project]);
  const { initialViewport, onMoveEnd } = useSharedViewport(projectId, viewportUserId);
  const minimapPanProps = useMinimapPanProps();
  const { visible: minimapVisible, toggle: toggleMinimap } = useSharedMinimapVisible();
  // Same grid preference the MLD canvas reads — otherwise the two backgrounds
  // visibly differ (different dot colour/spacing) every time you switch.
  const [gridStyle] = useState(loadGridStyle);

  const basePositions = useMemo(() => computeMcdPositions(model, project), [model, project]);
  const baseNodes = useMemo(() => buildMcdNodes(model, project, basePositions), [model, project, basePositions]);
  const { nodes, onNodesChange, resetPositions } = useMcdNodeDrag(baseNodes);
  const edges = useMcdEdges(model);

  return (
    <div className="relative h-full w-full">
      {model.warnings.length > 0 && <McdWarningsBanner warnings={model.warnings} />}
      <ReactFlow
        nodes={nodes}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView={!initialViewport}
        defaultViewport={initialViewport ?? undefined}
        onMoveEnd={onMoveEnd}
        {...CANVAS_VIEWPORT_PROPS}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="var(--color-canvas-grid)"
          bgColor="var(--color-bg-canvas)"
          gap={20}
          variant={gridStyle as BackgroundVariant}
        />
        <Panel position="bottom-left" className="nodrag nopan !bottom-4 !left-4">
          <CanvasZoomBar selectedIds={nodes.filter((n) => n.selected).map((n) => n.id)} />
        </Panel>
        <Panel position="bottom-center" className="nodrag nopan !bottom-4">
          <McdToolbar
            viewMode={viewMode}
            onSetViewMode={onSetViewMode}
            onResetPositions={resetPositions}
            minimapVisible={minimapVisible}
            onToggleMinimap={toggleMinimap}
          />
        </Panel>
        {minimapVisible && <MiniMap {...minimapPanProps} nodeColor={mcdMinimapNodeColor} />}
      </ReactFlow>
    </div>
  );
}
