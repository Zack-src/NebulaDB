import "./loadEnv.js";
import { readProjectFromDoc } from "@athanordb/shared";
import { diffTargetAgainstLive } from "@athanordb/dbml-engine";
import { listRevisions, reconstructDocAtRevision } from "./realtime/persistence.js";
import { getConnectionById } from "./modules/connections/repository.js";
import { createDatabaseDriver } from "./modules/connections/drivers/index.js";

const PROJECT_ID = "bab4eed2-ae08-4682-b6cc-ceeec4d1b5aa"; // DeepDetect
const PROJECT_NAME = "DeepDetect";
const CONNECTION_ID = "7110c72e-3e43-4d69-abe6-74b497cd9678"; // DeepDetect (mssql, localhost:14330)

async function main() {
  const revs = listRevisions(PROJECT_ID);
  const lastId = revs[revs.length - 1].id;
  const doc = reconstructDocAtRevision(PROJECT_ID, lastId);
  if (!doc) throw new Error("could not reconstruct doc");
  const targetProject = readProjectFromDoc(doc, PROJECT_ID, PROJECT_NAME);

  const conn = getConnectionById(CONNECTION_ID);
  if (!conn) throw new Error("connection not found");

  const driver = await createDatabaseDriver(conn);
  let liveProject;
  try {
    liveProject = await driver.introspectSchema();
  } finally {
    await driver.close().catch(() => {});
  }

  const diff = diffTargetAgainstLive(liveProject, targetProject);

  console.log(`# Live DB: ${liveProject.tables.length} tables, ${liveProject.refs.length} refs`);
  console.log(`# Athanor project: ${targetProject.tables.length} tables, ${targetProject.refs.length} refs`);
  console.log(`# hasChanges: ${diff.hasChanges}\n`);

  const addedTables = diff.tables.filter((t) => t.status === "added");
  const droppedTables = diff.tables.filter((t) => t.status === "dropped");
  const modifiedTables = diff.tables.filter((t) => t.status === "modified");

  console.log(`## Tables only in Athanor (not deployed to DB) — ${addedTables.length}`);
  for (const t of addedTables) console.log(`  + ${t.name} (${t.after?.fields.length} cols)`);

  console.log(`\n## Tables only in DB (not in Athanor project) — ${droppedTables.length}`);
  for (const t of droppedTables) console.log(`  - ${t.name} (${t.before?.fields.length} cols)`);

  console.log(`\n## Colonnes AJOUTEES dans Athanor mais absentes de la DB (non publiees)`);
  let countAthOnly = 0;
  for (const t of modifiedTables) {
    const added = t.fields.filter((f) => f.status === "added");
    for (const f of added) {
      console.log(`  ${t.name}.${f.name} (${f.after?.type})`);
      countAthOnly++;
    }
  }
  console.log(`  TOTAL: ${countAthOnly}`);

  console.log(`\n## Colonnes presentes en DB mais absentes du projet Athanor (ajout manuel)`);
  let countDbOnly = 0;
  for (const t of modifiedTables) {
    const dropped = t.fields.filter((f) => f.status === "dropped");
    for (const f of dropped) {
      console.log(`  ${t.name}.${f.name} (${f.before?.type})`);
      countDbOnly++;
    }
  }
  console.log(`  TOTAL: ${countDbOnly}`);

  console.log(`\n## Colonnes existant des deux cotes mais avec type/default different (hors pk/notNull cosmetique)`);
  let countTypeDiff = 0;
  for (const t of modifiedTables) {
    const modified = t.fields.filter((f) => f.status === "modified" && (f.typeChanged || f.defaultChanged));
    for (const f of modified) {
      const changes = [];
      if (f.typeChanged) changes.push(`type ${f.before?.type} -> ${f.after?.type}`);
      if (f.defaultChanged) changes.push(`default ${f.before?.default} -> ${f.after?.default}`);
      console.log(`  ${t.name}.${f.name}: ${changes.join(", ")}`);
      countTypeDiff++;
    }
  }
  console.log(`  TOTAL: ${countTypeDiff}`);

  console.log(`\n## (bruit) tables ou seul pk/notNull/index a change (composite keys, cosmetique)`);
  let noiseOnly = 0;
  for (const t of modifiedTables) {
    const realChange = t.fields.some((f) => f.status !== "modified" || f.typeChanged || f.defaultChanged || f.uniqueChanged);
    if (!realChange) noiseOnly++;
  }
  console.log(`  ${noiseOnly} / ${modifiedTables.length} tables modifiees n'ont QUE du bruit pk/notNull/index`);

  const addedRefs = diff.refs.filter((r) => r.status === "added");
  const droppedRefs = diff.refs.filter((r) => r.status === "dropped");
  console.log(`\n## FKs only in Athanor — ${addedRefs.length}`);
  for (const r of addedRefs) console.log(`  + ${r.fromTable}.${r.fromField} -> ${r.toTable}.${r.toField}`);
  console.log(`\n## FKs only in DB — ${droppedRefs.length}`);
  for (const r of droppedRefs) console.log(`  - ${r.fromTable}.${r.fromField} -> ${r.toTable}.${r.toField}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
