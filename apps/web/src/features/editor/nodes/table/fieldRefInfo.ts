import type { RefAction } from "@athanordb/shared";

/**
 * A ref where a given field is the FK ("from") side — what `FieldEditorPopover`
 * needs to offer ON DELETE/ON UPDATE right on the column that carries the FK,
 * not just on the relation's own edge (`EdgeSettingsPopover`).
 *
 * Its own leaf module rather than living on `nodeTypes.ts` or
 * `buildTableNodes.ts`: both of those already import from each other
 * (`buildTableNodes` builds `TableNodeType`/`TableNodeData`), and `TableNodeRow`/
 * `FieldEditorPopover` need this same type — putting it on either side would
 * add a reverse edge and turn that into a cycle (`check:circular` catches this).
 */
export interface FieldRefInfo {
  refId: string;
  onDelete?: RefAction;
  onUpdate?: RefAction;
  /** "table.field" this FK points at — for display only. */
  toLabel: string;
}
