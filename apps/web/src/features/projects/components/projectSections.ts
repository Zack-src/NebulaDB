import { ArchiveIcon, FolderIcon, TrashIcon } from "@/components/icons/Icons";
import type { IconDefinition } from "@/components/icons/iconDefinition";
import type { ProjectStatus, TranslationKeyOf } from "@/types";

export interface ProjectSection {
  key: ProjectStatus;
  labelKey: TranslationKeyOf;
  emptyKey: TranslationKeyOf;
  icon: IconDefinition;
}

export const PROJECT_SECTIONS: ProjectSection[] = [
  { key: "active", labelKey: "projects.section.active", emptyKey: "projects.section.activeEmpty", icon: FolderIcon },
  {
    key: "archived",
    labelKey: "projects.section.archived",
    emptyKey: "projects.section.archivedEmpty",
    icon: ArchiveIcon,
  },
  { key: "trashed", labelKey: "projects.section.trashed", emptyKey: "projects.section.trashedEmpty", icon: TrashIcon },
];
