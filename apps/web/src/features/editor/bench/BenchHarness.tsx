import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness.js";
import { writeProjectToDoc } from "@athanordb/shared";
import { setOfflineConnectionFactory, type ProjectConnection } from "@/features/collaboration/yjsClient";
import { ProjectEditor } from "@/features/editor/ProjectEditor";
import type { ProjectSummary, Session } from "@/types/index";
import { BENCH_PROJECT_ID, buildBenchProject, parseBenchConfig } from "./benchProject";
import { installBenchRunner } from "./benchRunner";

/**
 * The canvas perf harness: the **real** editor (same `ProjectEditor`, same
 * doc-sync/node/edge pipeline, same components) over a synthetic schema of a
 * chosen size, with the WebSocket transport swapped for a local pre-seeded
 * Y.Doc so a run measures the editor rather than the network or the server.
 *
 * Reached at `/#bench?tables=200&columns=8&detail=full`, code-split so none
 * of it is in the bundle any normal route loads. Driven by
 * `scripts/bench-web.mjs`; see `benchRunner.ts` for what the page exposes.
 *
 * Module scope on purpose: the connection has to be registered before
 * `ProjectEditor` first renders (it connects during its own first effect),
 * and the doc must survive React's mount/unmount cycles unchanged so two
 * scenarios in one run see the same schema.
 */
const config = parseBenchConfig(window.location.hash);

const doc = new Y.Doc();
const awareness = new Awareness(doc);
writeProjectToDoc(doc, buildBenchProject(config));

const connection: ProjectConnection = {
  doc,
  awareness,
  // No socket to close, and the doc deliberately outlives any unmount.
  disconnect() {},
};

setOfflineConnectionFactory((projectId) => (projectId === BENCH_PROJECT_ID ? connection : null));
installBenchRunner(doc, config);

const project: ProjectSummary = {
  id: BENCH_PROJECT_ID,
  name: config.dbml ? "bench" : "bench (no dbml)",
  status: "active",
  created_at: new Date(0).toISOString(),
  permission: "administrator",
};

const session: Session = {
  id: "bench-user",
  email: "bench@localhost",
  isAdmin: false,
  displayName: "Bench",
};

const noop = () => {};
const noopAsync = async () => {};

export default function BenchHarness() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <ProjectEditor
        project={project}
        session={session}
        onDisplayNameChange={noopAsync}
        onLogout={noop}
        onBack={noop}
      />
    </div>
  );
}
