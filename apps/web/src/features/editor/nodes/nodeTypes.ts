import type { Node } from "@xyflow/svelte";
import type {
  EnumDef,
  Field,
  RefAction,
  StickyNote,
  Table,
  TableGroup,
  TableIndex,
  Zone,
} from "@athanordb/shared";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import type { FieldRefInfo } from "@/features/editor/nodes/table/fieldRefInfo";

/**
 * The data every canvas node type carries, in one leaf module.
 *
 * The node *components* read these, and the node *builders*
 * (`hooks/useCanvasNodes/*`) produce them — keeping the types out of the
 * `.svelte` files is what lets plain TypeScript modules (and `types/index.ts`)
 * import them without pulling a component in.
 */

export interface TableNodeData {
  table: Table;
  /** Field ids that are either endpoint of some ref touching this table — always shown outside compact, even if not PK. */
  refFieldIds: Set<string>;
  /** Refs where a given field is the FK ("from") side, keyed by field id — lets `FieldEditorPopover` offer ON DELETE/ON UPDATE right on the column. */
  fieldRefs?: Map<string, FieldRefInfo[]>;
  /** `refId:onDelete:onUpdate` for every ref where this table is the FK side, joined — a cheap comparable stand-in for `fieldRefs`. */
  refActionsKey?: string;
  onUpdateRefAction?: (refId: string, patch: { onDelete?: RefAction; onUpdate?: RefAction }) => void;
  currentUser: string;
  palette: string[];
  /** True for a `view` grant — hides every editing affordance on the node. */
  readOnly?: boolean;
  selectedFieldId?: string | null;
  /** This table's validation issues (see `packages/dbml-engine/src/validate.ts`) — empty when the canvas-wide toggle is off. */
  issues?: ValidationIssue[];
  onSelectField: (fieldId: string | null) => void;
  onPaletteChange: (palette: string[]) => void;
  onRename: (name: string) => void;
  onGoToDbml?: () => void;
  /** Fires when the pointer enters/leaves a specific column row (`null` on leave) — narrows link highlighting to that column. */
  onFieldHoverChange: (fieldId: string | null) => void;
  /** Fires when the pointer enters/leaves a table (`null` on leave) — highlights all relations of the table. */
  onTableHoverChange?: (tableId: string | null) => void;
  onStyleChange: (color: string | undefined, borderColor: string | undefined) => void;
  onAddComment: (text: string, fieldId?: string) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateField?: (fieldId: string, updates: Partial<Field> | ((current: Field) => Partial<Field>)) => void;
  /** Drag-reorder a column: move `draggedFieldId` right before/after `targetFieldId`. */
  onReorderField?: (draggedFieldId: string, targetFieldId: string, before: boolean) => void;
  onAddField?: (field: Omit<Field, "id">) => void;
  onDeleteField?: (fieldId: string) => void;
  onAddIndex?: (fieldIds: string[], opts: { unique?: boolean; pk?: boolean; name?: string }) => void;
  onUpdateIndex?: (indexId: string, updates: Partial<Pick<TableIndex, "unique" | "pk" | "name">>) => void;
  onDeleteIndex?: (indexId: string) => void;
  [key: string]: unknown;
}

export type TableNodeType = Node<TableNodeData, "table">;

export interface ZoneNodeData {
  zone: Zone;
  palette: string[];
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onPaletteChange: (palette: string[]) => void;
  onLabelChange: (label: string) => void;
  onColorChange: (color: string) => void;
  onResize: (position: { x: number; y: number }, size: { width: number; height: number }) => void;
  [key: string]: unknown;
}

export type ZoneNodeType = Node<ZoneNodeData, "zone">;

export interface StickyNoteNodeData {
  note: StickyNote;
  palette: string[];
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onPaletteChange: (palette: string[]) => void;
  onTextChange: (text: string) => void;
  onColorChange: (color: string) => void;
  onResize: (position: { x: number; y: number }, size: { width: number; height: number }) => void;
  [key: string]: unknown;
}

export type StickyNoteNodeType = Node<StickyNoteNodeData, "sticky">;

export interface EnumNodeData {
  enumDef: EnumDef;
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onRename: (name: string) => void;
  onAddValue: () => void;
  onRenameValue: (valueId: string, name: string) => void;
  onDeleteValue: (valueId: string) => void;
  onReorderValue: (valueId: string, direction: "up" | "down") => void;
  [key: string]: unknown;
}

export type EnumNodeType = Node<EnumNodeData, "enum">;

export interface TableGroupNodeData {
  group: TableGroup;
  memberCount: number;
  /** True for a `view` grant — every editing affordance on this node is withheld. */
  readOnly?: boolean;
  onRename: (name: string) => void;
  onUngroup: () => void;
  [key: string]: unknown;
}

export type TableGroupNodeType = Node<TableGroupNodeData, "tablegroup">;
