import type { DatabaseConnectionSummary, DbAccessLevel, ProjectDriftEntry } from "@nebuladb/shared";
import { fetchProjectDrift, listProjectConnections } from "@/services/connectionsApi";
import { fetchMyDbAccess } from "@/services/dbAccessApi";

/**
 * The databases attached to the open project, as the editor needs them: the list and the selected
 * one (preselected when Deploy opens), the ones known to have been changed outside the schema
 * (`DriftBanner`), and what this user may query. Connections are managed from the admin console.
 */
export class ProjectConnectionsState {
  connections = $state.raw<DatabaseConnectionSummary[]>([]);
  connectionId = $state<string | null>(null);
  drift = $state.raw<ProjectDriftEntry[]>([]);
  /** Databases an instance administrator granted this user, by connection id. The server checks the grant on every console request; this only decides what is offered. */
  private dbAccess = $state.raw<ReadonlyMap<string, DbAccessLevel>>(new Map());

  constructor(
    private readonly projectId: () => string,
    private readonly isAdmin: () => boolean,
  ) {
    $effect(() => {
      listProjectConnections(this.projectId())
        .then((list) => {
          this.connections = list;
          if (!list.some((connection) => connection.id === this.connectionId)) this.connectionId = list[0]?.id ?? null;
        })
        .catch(() => {});
    });
    $effect(() => {
      this.projectId();
      this.drift = [];
      void this.refreshDrift();
    });
    $effect(() => {
      this.projectId();
      if (this.isAdmin()) return;
      fetchMyDbAccess()
        .then(
          (answer) => (this.dbAccess = new Map(answer.connections.map((entry) => [entry.connectionId, entry.level]))),
        )
        .catch(() => {});
    });
  }

  get activeConnection(): DatabaseConnectionSummary | null {
    return this.connections.find((connection) => connection.id === this.connectionId) ?? null;
  }

  mayQuery = (id: string | null | undefined): boolean => this.isAdmin() || (id ? this.dbAccess.has(id) : false);

  refreshDrift = (): Promise<void> =>
    fetchProjectDrift(this.projectId())
      .then((entries) => {
        this.drift = entries.filter((entry) => entry.outOfSchemaAt);
      })
      // Offline or the perf harness: no banner is better than a broken editor.
      .catch(() => {});
}
