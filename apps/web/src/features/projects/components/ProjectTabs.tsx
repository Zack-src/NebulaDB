import { ArchiveIcon, FolderIcon, TrashIcon } from "@/components/icons/Icons";
import type { IconProps } from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";
import type { ProjectStatus, ProjectSummary, TranslationKeyOf } from "@/types";

export interface ProjectSection {
  key: ProjectStatus;
  labelKey: TranslationKeyOf;
  emptyKey: TranslationKeyOf;
  icon: (props: IconProps) => JSX.Element;
}

export const PROJECT_SECTIONS: ProjectSection[] = [
  { key: "active", labelKey: "projects.section.active", emptyKey: "projects.section.activeEmpty", icon: FolderIcon },
  { key: "archived", labelKey: "projects.section.archived", emptyKey: "projects.section.archivedEmpty", icon: ArchiveIcon },
  { key: "trashed", labelKey: "projects.section.trashed", emptyKey: "projects.section.trashedEmpty", icon: TrashIcon },
];

export interface ProjectTabsProps {
  projects: ProjectSummary[];
  section: ProjectStatus;
  onSectionChange: (section: ProjectStatus) => void;
}

/**
 * Left-rail section nav (active/archived/trashed), each with a live count —
 * the Figma-style "Recents / Drafts / Trash" file-browser pattern, in place
 * of the horizontal tab bar this used to be.
 */
export function ProjectTabs({ projects, section, onSectionChange }: ProjectTabsProps) {
  const { t } = useTranslation();

  return (
    <nav className="flex flex-col gap-0.5">
      {PROJECT_SECTIONS.map((entry) => {
        const count = projects.filter((project) => project.status === entry.key).length;
        const active = section === entry.key;
        return (
          <button
            key={entry.key}
            onClick={() => onSectionChange(entry.key)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
              active ? "bg-primary-light text-primary" : "text-text-secondary hover:bg-surface-hover hover:text-text"
            }`}
          >
            <entry.icon size={15} />
            <span className="flex-1">{t(entry.labelKey)}</span>
            {count > 0 && (
              <span
                className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                  active ? "bg-primary/20 text-primary" : "bg-surface-hover text-text-muted"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
