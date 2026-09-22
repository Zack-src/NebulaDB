import { useState } from "react";
import { ErrorText } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/List";
import { SELECT_CLASS } from "@/components/ui/inputStyles";
import { ConnectionManagerModal } from "@/features/connections/ConnectionManagerModal";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchProjects } from "@/services/projectsApi";

/**
 * Database connections moved here from the project editor's toolbar — they're
 * a bigger blast radius than a schema edit (a live network host or local file
 * the server reaches, and generated SQL run against it on deploy), so
 * managing them is now an admin-only action. A project can still have several
 * connections, same as before; this just adds the project picker the editor
 * used to skip by already being inside one project.
 */
export function ConnectionsTab() {
  const { t } = useTranslation();
  const projects = useAsyncResource(fetchProjects);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const activeProjects = (projects.data ?? []).filter((p) => p.status === "active");
  const selectedProject = activeProjects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <div>
      <p className="mb-5 max-w-[560px] text-xs text-text-muted">{t("admin.connections.hint")}</p>

      <div className="max-w-[420px]">
        <label className="mb-1 block text-xs font-medium text-text-muted">{t("admin.connections.projectLabel")}</label>
        <select
          className={SELECT_CLASS}
          value={selectedProjectId}
          onChange={(event) => setSelectedProjectId(event.target.value)}
        >
          <option value="">{t("admin.connections.selectProject")}</option>
          {activeProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {projects.error && <ErrorText>{projects.error}</ErrorText>}
      {!projects.loading && activeProjects.length === 0 && (
        <EmptyState>{t("admin.connections.noProjects")}</EmptyState>
      )}

      {selectedProject && (
        <ConnectionManagerModal projectId={selectedProject.id} onClose={() => setSelectedProjectId("")} />
      )}
    </div>
  );
}
