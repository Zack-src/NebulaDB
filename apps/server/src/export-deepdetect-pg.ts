import { promises as fs } from "node:fs";
import { readProjectFromDoc } from "@athanordb/shared";
import { projectToSql } from "@athanordb/dbml-engine";
import { listRevisions, reconstructDocAtRevision } from "./realtime/persistence.js";

const PROJECT_ID = "bab4eed2-ae08-4682-b6cc-ceeec4d1b5aa"; // DeepDetect
const PROJECT_NAME = "DeepDetect";

async function main() {
  const revs = listRevisions(PROJECT_ID);
  const lastId = revs[revs.length - 1].id;
  const doc = reconstructDocAtRevision(PROJECT_ID, lastId);
  if (!doc) throw new Error(`revision ${lastId} not found`);
  const project = readProjectFromDoc(doc, PROJECT_ID, PROJECT_NAME);
  const pgSql = projectToSql(project, "postgres");
  await fs.writeFile("../../scripts/deepdetect-new-postgres.sql", pgSql, "utf8");
  console.log("wrote scripts/deepdetect-new-postgres.sql");
}
main().catch((err) => { console.error(err); process.exit(1); });
