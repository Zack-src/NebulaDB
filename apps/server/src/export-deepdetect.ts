import { promises as fs } from "node:fs";
import { readProjectFromDoc } from "@athanordb/shared";
import { projectToDbml, projectToSql } from "@athanordb/dbml-engine";
import { listRevisions, reconstructDocAtRevision } from "./realtime/persistence.js";

const PROJECT_ID = "bab4eed2-ae08-4682-b6cc-ceeec4d1b5aa"; // DeepDetect
const PROJECT_NAME = "DeepDetect";

async function main() {
  const revs = listRevisions(PROJECT_ID);
  if (revs.length === 0) throw new Error("no revisions for project");
  const lastId = revs[revs.length - 1].id;
  const doc = reconstructDocAtRevision(PROJECT_ID, lastId);
  if (!doc) throw new Error("could not reconstruct doc");
  const project = readProjectFromDoc(doc, PROJECT_ID, PROJECT_NAME);

  console.log(`tables: ${project.tables.length}, refs: ${project.refs.length}, enums: ${project.enums.length}`);

  const dbml = projectToDbml(project, { includeVisualMetadata: false });
  await fs.writeFile("../../scripts/deepdetect-new.dbml", dbml, "utf8");

  const mssqlSql = projectToSql(project, "mssql");
  await fs.writeFile("../../scripts/deepdetect-new-mssql.sql", mssqlSql, "utf8");

  console.log("wrote scripts/deepdetect-new.dbml and scripts/deepdetect-new-mssql.sql");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
