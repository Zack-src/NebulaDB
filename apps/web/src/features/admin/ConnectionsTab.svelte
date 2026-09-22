<script lang="ts">
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { SELECT_CLASS } from "@/components/ui/inputStyles";
  import ConnectionManagerModal from "@/features/connections/ConnectionManagerModal.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchProjects } from "@/services/projectsApi";

  /**
   * Database connections moved here from the project editor's toolbar — they're
   * a bigger blast radius than a schema edit (a live network host or local file
   * the server reaches, and generated SQL run against it on deploy), so
   * managing them is now an admin-only action. A project can still have several
   * connections, same as before; this just adds the project picker the editor
   * used to skip by already being inside one project.
   */
  const { t } = useTranslation();
  const projects = useAsyncResource(fetchProjects);
  let selectedProjectId = $state("");

  const activeProjects = $derived((projects.data ?? []).filter((p) => p.status === "active"));
  const selectedProject = $derived(activeProjects.find((p) => p.id === selectedProjectId) ?? null);
</script>

<div>
  <p class="mb-5 max-w-[560px] text-xs text-text-muted">{t("admin.connections.hint")}</p>

  <div class="max-w-[420px]">
    <label class="mb-1 block text-xs font-medium text-text-muted" for="admin-connections-project">
      {t("admin.connections.projectLabel")}
    </label>
    <select id="admin-connections-project" class={SELECT_CLASS} bind:value={selectedProjectId}>
      <option value="">{t("admin.connections.selectProject")}</option>
      {#each activeProjects as project (project.id)}
        <option value={project.id}>{project.name}</option>
      {/each}
    </select>
  </div>

  {#if projects.error}<ErrorText>{projects.error}</ErrorText>{/if}
  {#if !projects.loading && activeProjects.length === 0}
    <EmptyState>{t("admin.connections.noProjects")}</EmptyState>
  {/if}

  {#if selectedProject}
    <ConnectionManagerModal projectId={selectedProject.id} onClose={() => (selectedProjectId = "")} />
  {/if}
</div>
