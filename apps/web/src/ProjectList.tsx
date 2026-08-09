import { useState } from "react";
import { PlusIcon, FolderIcon, TrashIcon } from "./Icons.js";
import { ProjectTeamsModal } from "./ProjectTeamsModal.js";
import { PROJECT_SECTIONS, ProjectTabs } from "./projectList/ProjectTabs.js";
import { ProjectCard } from "./projectList/ProjectCard.js";
import { DeleteProjectModal } from "./projectList/DeleteProjectModal.js";
import { EmptyTrashModal } from "./projectList/EmptyTrashModal.js";
import { Button } from "./ui/Button.js";
import { ErrorText } from "./ui/Alert.js";
import { EmptyState } from "./ui/List.js";
import { SkeletonCardGrid } from "./ui/Skeleton.js";
import { Input } from "./ui/Input.js";
import type { CreateProjectResult } from "./hooks/useProjects.js";
import type { ProjectStatus, ProjectSummary } from "./types.js";

export function ProjectList(props: {
  projects: ProjectSummary[];
  loaded: boolean;
  onCreateProject: (name: string) => Promise<CreateProjectResult>;
  onOpen: (p: ProjectSummary) => void;
  onRename: (p: ProjectSummary, name: string) => void;
  onSetStatus: (p: ProjectSummary, status: ProjectStatus) => void;
  onDeleteForever: (p: ProjectSummary) => Promise<string | null>;
  onEmptyTrash: (projects: ProjectSummary[]) => Promise<string | null>;
}) {
  const { projects, loaded, onCreateProject, onOpen, onRename, onSetStatus, onDeleteForever, onEmptyTrash } = props;
  const [section, setSection] = useState<ProjectStatus>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [teamsTarget, setTeamsTarget] = useState<ProjectSummary | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashError, setEmptyTrashError] = useState<string | null>(null);
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const startRename = (p: ProjectSummary) => {
    setRenamingId(p.id);
    setNameDraft(p.name);
  };

  const commitRename = (p: ProjectSummary) => {
    setRenamingId(null);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== p.name) onRename(p, trimmed);
  };

  const openDeleteConfirm = (p: ProjectSummary) => {
    setDeleteError(null);
    setDeleteTarget(p);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const err = await onDeleteForever(deleteTarget);
    setDeleteBusy(false);
    if (err) setDeleteError(err);
    else setDeleteTarget(null);
  };

  const current = PROJECT_SECTIONS.find((s) => s.key === section)!;
  const visible = projects
    .filter((p) => p.status === section)
    .filter((p) => (searchQuery.trim() ? p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) : true));
  const openable = section !== "trashed";
  const trashedDeletable = projects.filter((p) => p.status === "trashed" && p.permission === "administrator");

  const confirmEmptyTrash = async () => {
    setEmptyTrashBusy(true);
    const err = await onEmptyTrash(trashedDeletable);
    setEmptyTrashBusy(false);
    if (err) setEmptyTrashError(err);
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
    const name = `Nouveau schéma ${projects.length + 1}`;
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
    setNameDraft(name);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — Figma-style section nav */}
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border/60 bg-surface/40 p-4 sm:flex">
        <Button variant="primary" onClick={handleCreate} disabled={creating} className="w-full gap-2 text-xs">
          <PlusIcon size={14} /> {creating ? "Création…" : "Nouveau projet"}
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
                <h1 className="text-xl font-extrabold tracking-tight">Mes schémas DBML</h1>
                <p className="text-xs text-text-muted">Diagrammes de bases de données versionnés et synchronisés en direct.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Input
                wrapperClassName="w-full sm:w-56"
                placeholder="Rechercher un schéma…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Button variant="primary" onClick={handleCreate} disabled={creating} className="shrink-0 gap-2 text-xs sm:hidden">
                <PlusIcon size={14} /> Nouveau
              </Button>
            </div>
          </div>

          {/* Section nav collapses here on narrow viewports, where the rail is hidden */}
          <div className="mb-4 sm:hidden">
            <ProjectTabs projects={projects} section={section} onSectionChange={setSection} />
          </div>

          {createError && <ErrorText>{createError}</ErrorText>}
          {section === "trashed" && trashedDeletable.length > 0 && (
            <div className="mb-3 flex justify-end">
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setEmptyTrashError(null);
                  setEmptyTrashOpen(true);
                }}
              >
                <TrashIcon size={13} /> Vider la corbeille ({trashedDeletable.length})
              </Button>
            </div>
          )}
          {!loaded ? (
            /* Placeholders, not the empty state: before the fetch settles an
               empty array means "unknown", and claiming the user has no
               projects is a wrong statement rather than a slow one. */
            <SkeletonCardGrid count={4} />
          ) : visible.length === 0 ? (
            <EmptyState>{searchQuery.trim() ? "Aucun projet ne correspond à votre recherche." : current.empty}</EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {visible.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  section={section}
                  openable={openable}
                  isRenaming={renamingId === p.id}
                  nameDraft={nameDraft}
                  onNameDraftChange={setNameDraft}
                  onOpen={() => onOpen(p)}
                  onStartRename={() => startRename(p)}
                  onCommitRename={() => commitRename(p)}
                  onCancelRename={() => setRenamingId(null)}
                  onSetStatus={(status) => onSetStatus(p, status)}
                  onDeleteForever={() => openDeleteConfirm(p)}
                  onManageTeams={() => setTeamsTarget(p)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {deleteTarget && (
        <DeleteProjectModal
          target={deleteTarget}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {emptyTrashOpen && (
        <EmptyTrashModal
          count={trashedDeletable.length}
          busy={emptyTrashBusy}
          error={emptyTrashError}
          onConfirm={confirmEmptyTrash}
          onClose={() => setEmptyTrashOpen(false)}
        />
      )}
      {teamsTarget && <ProjectTeamsModal project={teamsTarget} onClose={() => setTeamsTarget(null)} />}
    </div>
  );
}
