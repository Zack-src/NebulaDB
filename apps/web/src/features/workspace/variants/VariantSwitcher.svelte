<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, LayersIcon } from "@/components/icons/Icons";
  import Menu from "@/components/ui/Menu.svelte";
  import MenuItem from "@/components/ui/MenuItem.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchFamily, type ProjectFamily } from "@/services/variantsApi";
  import { familyChanges } from "./familyState.svelte";

  /**
   * Next to the project's name, for an original with variants or a variant:
   * the whole family in one menu, to go from one client to another without
   * going back to the list. Shows nothing for any other project.
   */
  let { projectId, onOpenProject }: { projectId: string; onOpenProject: (projectId: string) => void } = $props();

  const { t } = useTranslation();
  let family = $state.raw<ProjectFamily | null>(null);
  $effect(() => {
    const id = projectId;
    void familyChanges.version;
    let active = true;
    fetchFamily(id)
      .then((loaded) => active && (family = loaded))
      // Without it the header simply has no switcher.
      .catch(() => active && (family = null));
    return () => {
      active = false;
    };
  });
  const current = $derived(family?.members.find((member) => member.id === projectId));
</script>

{#if family && family.members.length > 1}
  <Menu aria-label={t("variants.switcher")} minWidth={220}>
    {#snippet trigger(props)}
      <button
        {...props}
        class="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption font-medium text-text-secondary hover:bg-surface-hover hover:text-text"
        data-testid="variant-switcher"
      >
        <Icon icon={LayersIcon} size={11} class="text-primary" />
        {current?.original ? t("variants.switcherOriginal") : t("variants.switcherVariant")}
        <Icon icon={ChevronRightIcon} size={10} class="rotate-90" />
      </button>
    {/snippet}
    {#each family.members as member (member.id)}
      <MenuItem
        checked={member.id === projectId}
        onSelect={() => member.id !== projectId && onOpenProject(member.id)}
      >
        {member.name}{member.original ? ` — ${t("variants.original")}` : ""}
      </MenuItem>
    {/each}
  </Menu>
{/if}
