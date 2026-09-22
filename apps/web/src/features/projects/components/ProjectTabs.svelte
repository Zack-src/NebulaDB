<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { ProjectStatus, ProjectSummary } from "@/types";
  import { PROJECT_SECTIONS } from "./projectSections";

  /**
   * Left-rail section nav (active/archived/trashed), each with a live count —
   * the Figma-style "Recents / Drafts / Trash" file-browser pattern, in place
   * of the horizontal tab bar this used to be.
   */
  let {
    projects,
    section,
    onSectionChange,
  }: {
    projects: ProjectSummary[];
    section: ProjectStatus;
    onSectionChange: (section: ProjectStatus) => void;
  } = $props();

  const { t } = useTranslation();
</script>

<nav class="flex flex-col gap-0.5">
  {#each PROJECT_SECTIONS as entry (entry.key)}
    {@const count = projects.filter((project) => project.status === entry.key).length}
    {@const active = section === entry.key}
    <button
      onclick={() => onSectionChange(entry.key)}
      class={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
        active ? "bg-primary-light text-primary" : "text-text-secondary hover:bg-surface-hover hover:text-text"
      }`}
    >
      <Icon icon={entry.icon} size={15} />
      <span class="flex-1">{t(entry.labelKey)}</span>
      {#if count > 0}
        <span
          class={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
            active ? "bg-primary/20 text-primary" : "bg-surface-hover text-text-muted"
          }`}
        >
          {count}
        </span>
      {/if}
    </button>
  {/each}
</nav>
