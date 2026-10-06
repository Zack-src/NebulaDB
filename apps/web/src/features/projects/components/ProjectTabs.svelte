<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { ProjectStatus, ProjectSummary } from "@/types";
  import { PROJECT_SECTIONS } from "./projectSections";

  /**
   * Project-list filters, kept in one horizontal row under the page actions.
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

<nav class="flex gap-1 overflow-x-auto border-b border-border pb-3" aria-label={t("projects.title")}>
  {#each PROJECT_SECTIONS as entry (entry.key)}
    {@const count = projects.filter((project) => project.status === entry.key).length}
    {@const active = section === entry.key}
    <button
      onclick={() => onSectionChange(entry.key)}
      aria-current={active ? "page" : undefined}
      class={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-[12px] font-medium transition-colors ${
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
