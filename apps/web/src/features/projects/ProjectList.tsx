import { useState } from "react";
import { PlusIcon, FolderIcon, TrashIcon } from "@/components/icons/Icons";
import { useDraftValue } from "@/hooks/useDraftValue";
import { ProjectTeamsModal } from "@/features/teams/ProjectTeamsModal";
import { PROJECT_SECTIONS, ProjectTabs } from "@/features/projects/components/ProjectTabs";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { DeleteProjectModal } from "@/features/projects/components/DeleteProjectModal";
import { EmptyTrashModal } from "@/features/projects/components/EmptyTrashModal";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/List";
import { SkeletonCardGrid } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { useTranslation } from "@/i18n/useTranslation";
import type { CreateProjectResult } from "@/features/projects/hooks/useProjects";
import type { ProjectStatus, ProjectSummary } from "@/types";

export interface ProjectListProps {
  projects: ProjectSummary[];
  loaded: boolean;
  onCreateProject: (name: string) => Promise<CreateProjectResult>;
  onOpen: (project: ProjectSummary) => void;
  onRename: (project: ProjectSummary, name: string) => void;
  onSetStatus: (project: ProjectSummary, status: ProjectStatus) => void;
  onDeleteForever: (project: ProjectSummary) => Promise<string | null>;
  onEmptyTrash: (projects: ProjectSummary[]) => Promise<string | null>;
}

export function ProjectList({
  projects,
  loaded,
  onCreateProject,
  onOpen,
  onRename,
  onSetStatus,
  onDeleteForever,
  onEmptyTrash,
}: ProjectListProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<ProjectStatus>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renamingProject = projects.find((p) => p.id === renamingId) ?? null;
  const nameDraft = useDraftValue(renamingProject?.name ?? "", (next) => {
    if (renamingProject) onRename(renamingProject, next ?? "");
  });
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [teamsTarget, setTeamsTarget] = useState<ProjectSummary | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashError, setEmptyTrashError] = useState<string | null>(null);
  const [emptyTrashPending, setEmptyTrashPending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const startRename = (project: ProjectSummary) => {
    setRenamingId(project.id);
  };

  const commitRename = () => {
    nameDraft.commit();
    setRenamingId(null);
  };

  const openDeleteConfirmation = (project: ProjectSummary) => {
    setDeleteError(null);
    setDeleteTarget(project);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletePending(true);
    const failure = await onDeleteForever(deleteTarget);
    setDeletePending(false);
    if (failure) setDeleteError(failure);
    else setDeleteTarget(null);
  };

  const currentSection = PROJECT_SECTIONS.find((entry) => entry.key === section)!;
  const normalisedQuery = searchQuery.trim().toLowerCase();
  const visibleProjects = projects
    .filter((project) => project.status === section)
    .filter((project) => (normalisedQuery ? project.name.toLowerCase().includes(normalisedQuery) : true));
  const openable = section !== "trashed";
  const deletableTrash = projects.filter(
    (project) => project.status === "trashed" && project.permission === "administrator",
  );

  const confirmEmptyTrash = async () => {
    setEmptyTrashPending(true);
    const failure = await onEmptyTrash(deletableTrash);
    setEmptyTrashPending(false);
    if (failure) setEmptyTrashError(failure);
    else setEmptyTrashOpen(false);
  };

  /**
   * Instant-create, Figma-file-browser style: no name dialog, a placeholder
   * name is assigned immediately and the new tile opens straight into rename
   * mode. The created id comes back from the request itself rather than a
   * shared "pending name" field — a previous version threaded the name
   * through a bit of state and fired the create before the state write had
   * landed, so the very first click on a fresh list silently created nothing.
   */
  const handleCreate = async () => {
    if (creating) return;
    const name = t("projects.newSchemaName", { index: projects.length + 1 });
    setCreateError(null);
    setCreating(true);
    const result = await onCreateProject(name);
    setCreating(false);
    if ("error" in result) {
      setCreateError(result.error);
      return;
    }
    if (section !== "active") setSection("active");
    setRenamingId(result.id);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — Figma-style section nav */}
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border/60 bg-surface/40 p-4 sm:flex">
        <Button variant="primary" onClick={handleCreate} disabled={creating} className="w-full gap-2 text-xs">
          <PlusIcon size={14} /> {creating ? t("projects.creating") : t("projects.newProject")}
        </Button>
        <ProjectTabs projects={projects} section={section} onSectionChange={setSection} />
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-[1040px]">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
                <FolderIcon size={18} />
              </span>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">{t("projects.title")}</h1>
                <p className="text-xs text-text-muted">{t("projects.subtitle")}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Input
                wrapperClassName="w-full sm:w-56"
                placeholder={t("projects.searchPlaceholder")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={creating}
                className="shrink-0 gap-2 text-xs sm:hidden"
              >
                <PlusIcon size={14} /> {t("projects.new")}
              </Button>
            </div>
          </div>

          {/* Section nav collapses here on narrow viewports, where the rail is hidden */}
          <div className="mb-4 sm:hidden">
            <ProjectTabs projects={projects} section={section} onSectionChange={setSection} />
          </div>

          {createError && <ErrorText>{createError}</ErrorText>}
          {section === "trashed" && deletableTrash.length > 0 && (
            <div className="mb-3 flex justify-end">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setEmptyTrashError(null);
                  setEmptyTrashOpen(true);
                }}
              >
                <TrashIcon size={13} /> {t("projects.emptyTrash.button", { count: deletableTrash.length })}
              </Button>
            </div>
          )}
          {!loaded ? (
            /* Placeholders, not the empty state: before the fetch settles an
               empty array means "unknown", and claiming the user has no
               projects is a wrong statement rather than a slow one. */
            <SkeletonCardGrid count={4} />
          ) : visibleProjects.length === 0 ? (
            <EmptyState>{normalisedQuery ? t("projects.noSearchMatch") : t(currentSection.emptyKey)}</EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {visibleProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  section={section}
                  openable={openable}
                  isRenaming={renamingId === project.id}
                  nameDraft={nameDraft.value}
                  onNameDraftChange={nameDraft.setValue}
                  onOpen={() => onOpen(project)}
                  onStartRename={() => startRename(project)}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                  onSetStatus={(status) => onSetStatus(project, status)}
                  onDeleteForever={() => openDeleteConfirmation(project)}
                  onManageTeams={() => setTeamsTarget(project)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <DeleteProjectModal
          target={deleteTarget}
          busy={deletePending}
          error={deleteError}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {emptyTrashOpen && (
        <EmptyTrashModal
          count={deletableTrash.length}
          busy={emptyTrashPending}
          error={emptyTrashError}
          onConfirm={confirmEmptyTrash}
          onClose={() => setEmptyTrashOpen(false)}
        />
      )}
      {teamsTarget && <ProjectTeamsModal project={teamsTarget} onClose={() => setTeamsTarget(null)} />}
    </div>
  );
}
