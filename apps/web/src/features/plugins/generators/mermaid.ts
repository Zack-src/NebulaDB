import type { Project } from "@athanordb/shared";

export function generateMermaid(project: Project): string {
  const lines: string[] = ["erDiagram"];
  const tableMap = new Map(project.tables.map((t) => [t.id, t]));

  // Relations
  for (const ref of project.refs) {
    const fromTable = tableMap.get(ref.from.tableId);
    const toTable = tableMap.get(ref.to.tableId);

    if (fromTable && toTable) {
      let relSymbol: string;
      if (ref.cardinality === "one-to-one") {
        relSymbol = "||--||";
      } else if (ref.cardinality === "many-to-many") {
        relSymbol = "}o--o{";
      } else {
        relSymbol = "||--o{";
      }
      const label = ref.name ? `"${ref.name}"` : `""`;
      lines.push(`    ${fromTable.name} ${relSymbol} ${toTable.name} : ${label}`);
    }
  }

  // Tables & fields
  for (const table of project.tables) {
    lines.push(`    ${table.name} {`);
    for (const field of table.fields) {
      const typeClean = (field.type || "string").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      let keyFlag = "";
      if (field.pk) keyFlag = " PK";
      else if (field.unique) keyFlag = " UK";
      const comment = field.note ? ` "${field.note}"` : "";
      lines.push(`        ${typeClean} ${field.name}${keyFlag}${comment}`);
    }
    lines.push(`    }`);
  }

  return lines.join("\n") + "\n";
}
