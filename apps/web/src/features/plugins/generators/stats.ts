import type { Project } from "@athanordb/shared";

export interface SchemaMetrics {
  tableCount: number;
  fieldCount: number;
  refCount: number;
  enumCount: number;
  zoneCount: number;
  stickyNoteCount: number;
  tableGroupCount: number;
  avgFieldsPerTable: number;
}

export function calculateSchemaStats(project: Project): SchemaMetrics {
  const tableCount = project.tables.length;
  const fieldCount = project.tables.reduce((acc, t) => acc + t.fields.length, 0);
  const refCount = project.refs.length;
  const enumCount = project.enums.length;
  const zoneCount = project.zones.length;
  const stickyNoteCount = project.stickyNotes.length;
  const tableGroupCount = project.tableGroups?.length || 0;
  const avgFieldsPerTable = tableCount > 0 ? Number((fieldCount / tableCount).toFixed(1)) : 0;

  return {
    tableCount,
    fieldCount,
    refCount,
    enumCount,
    zoneCount,
    stickyNoteCount,
    tableGroupCount,
    avgFieldsPerTable,
  };
}
