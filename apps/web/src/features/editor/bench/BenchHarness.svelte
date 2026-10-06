<script lang="ts" module>
  import * as Y from "yjs";
  import { Awareness } from "y-protocols/awareness.js";
  import { writeProjectToDoc } from "@nebuladb/shared";
  import { setOfflineConnectionFactory, type ProjectConnection } from "@/features/collaboration/yjsClient";
  import type { ProjectSummary, Session } from "@/types/index";
  import { BENCH_PROJECT_ID, buildBenchProject, parseBenchConfig } from "./benchProject";
  import { installBenchRunner } from "./benchRunner";

    /**
     * The canvas perf harness: the **real** editor over a synthetic schema, with the WebSocket
     * swapped for a local pre-seeded Y.Doc, so a run measures the editor, not the network.
     *
     * Reached at `/#bench?tables=200&columns=8&detail=full`, code-split; driven by
     * `scripts/bench-web.mjs`. Module scope on purpose: the connection must be registered before
     * `ProjectEditor` first renders, and the doc must survive remounts so scenarios share a schema.
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
</script>

<script lang="ts">
  import ProjectEditor from "@/features/editor/ProjectEditor.svelte";
</script>

<div style="width: 100vw; height: 100vh">
  <ProjectEditor {project} {session} onDisplayNameChange={noopAsync} onLogout={noop} onBack={noop} />
</div>
