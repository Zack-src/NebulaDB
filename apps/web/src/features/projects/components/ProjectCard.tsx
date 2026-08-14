import { MAX_NAME_LENGTH } from "@athanordb/shared";
import { ArchiveIcon, PencilIcon, RestoreIcon, TrashIcon, UsersIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
import { formatDate } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import type { ProjectStatus, ProjectSummary } from "@/types";

/** Cheap string hash — deterministic per project id, no crypto needed. */
function hashOfId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

const ACCENTS = ["#6366f1", "#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];
const THUMBNAIL_BLOCK_COUNT = 3;

/**
 * A small abstract "schema" thumbnail generated from the project id — a few
 * rounded blocks over the same dot grid the real canvas uses. There's no real
 * preview to render (no thumbnail pipeline), so every card getting an
 * identical folder icon would read as flatter/more generic than the actual
 * product; this at least makes each tile visually distinct and echoes the
 * canvas it opens into.
 */
function ProjectThumbnail({ id, accent }: { id: string; accent: string }) {
  const hash = hashOfId(id);
  const blocks = Array.from({ length: THUMBNAIL_BLOCK_COUNT }, (_, index) => {
    const seed = hash >> (index * 6);
    return {
      width: 34 + (seed % 28),
      height: 16 + ((seed >> 3) % 14),
      left: 10 + ((seed >> 6) % 55),
      top: 10 + ((seed >> 9) % 45),
    };
  });

  return (
    <div
      className="relative h-[104px] w-full overflow-hidden bg-bg-canvas"
      style={{ backgroundImage: "radial-gradient(#292d3f 1px, transparent 1px)", backgroundSize: "12px 12px" }}
    >
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(120px 80px at 20% 20%, ${accent}22, transparent)` }}
      />
      {blocks.map((block, index) => (
        <span
          key={index}
          className="absolute rounded-md border"
          style={{
            left: block.left,
            top: block.top,
            width: block.width,
            height: block.height,
            background: `${accent}1f`,
            borderColor: `${accent}55`,
          }}
        />
      ))}
    </div>
  );
}

export interface ProjectCardProps {
  project: ProjectSummary;
  section: ProjectStatus;
  openable: boolean;
  isRenaming: boolean;
  nameDraft: string;
  onNameDraftChange: (value: string) => void;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSetStatus: (status: ProjectStatus) => void;
  onDeleteForever: () => void;
  onManageTeams: () => void;
}

/** One project tile: open-on-click, plus the per-section actions admins get. */
export function ProjectCard({
  project,
  section,
  openable,
  isRenaming,
  nameDraft,
  onNameDraftChange,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSetStatus,
  onDeleteForever,
  onManageTeams,
}: ProjectCardProps) {
  const { t, locale } = useTranslation();
  const accent = ACCENTS[hashOfId(project.id) % ACCENTS.length];

  return (
    <div
      className={`group block w-full overflow-hidden rounded-xl border border-border bg-surface text-left shadow-xs transition-[box-shadow,transform,border-color] duration-150 ${
        openable ? "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md" : "cursor-default"
      }`}
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={() => openable && !isRenaming && onOpen()}
      onKeyDown={(event) => {
        if (!openable || isRenaming) return;
        // The card holds buttons and a rename field inside it. Without this
        // guard, Enter or Space on any of them bubbled up here and opened the
        // project as well — so archiving a project from the keyboard also
        // navigated into it. The check has to come before `preventDefault`,
        // or Space on a nested button gets swallowed instead.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <ProjectThumbnail id={project.id} accent={accent} />

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          {isRenaming ? (
            <input
              autoFocus
              className={`${INPUT_SM_CLASS} mb-0.5 w-full font-semibold`}
              value={nameDraft}
              maxLength={MAX_NAME_LENGTH}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommitRename();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onCancelRename();
                }
              }}
            />
          ) : (
            <div
              className="mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-text"
              data-tooltip={openable ? t("projects.card.doubleClickToRename") : undefined}
              onDoubleClick={(event) => {
                if (!openable) return;
                event.stopPropagation();
                onStartRename();
              }}
            >
              {project.name}
            </div>
          )}

          {/* Server re-checks every mutating call regardless — this is UX only, never the security boundary. */}
          {project.permission === "administrator" && (
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              {section === "trashed" ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-tooltip={t("projects.card.restore")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetStatus("active");
                    }}
                  >
                    <RestoreIcon size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-tooltip={t("projects.deleteForever.action")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteForever();
                    }}
                  >
                    <TrashIcon size={13} />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-tooltip={t("common.rename")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartRename();
                    }}
                  >
                    <PencilIcon size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-tooltip={t("projects.card.manageTeams")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onManageTeams();
                    }}
                  >
                    <UsersIcon size={13} />
                  </Button>
                  {section === "archived" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-tooltip={t("projects.card.restore")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSetStatus("active");
                      }}
                    >
                      <RestoreIcon size={13} />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-tooltip={t("projects.card.archive")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSetStatus("archived");
                      }}
                    >
                      <ArchiveIcon size={13} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-tooltip={t("projects.card.moveToTrash")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetStatus("trashed");
                    }}
                  >
                    <TrashIcon size={13} />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
          {t("projects.card.createdOn", { date: formatDate(project.created_at, locale) })}
          {project.permission === "view" && (
            <Badge tone="muted" className="ml-1">
              {t("projects.card.readOnly")}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
