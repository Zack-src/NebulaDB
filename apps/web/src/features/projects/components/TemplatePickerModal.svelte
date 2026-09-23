<script lang="ts">
  import { PROJECT_TEMPLATES, type ProjectTemplateId } from "@athanordb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { TableIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { TEMPLATE_COPY } from "./templateCopy";

  /**
   * Starter-schema gallery. Each tile lists the template's tables straight
   * from its layout map rather than parsing its DBML — the list is all the
   * preview needs, and it keeps `@dbml/core` out of the dashboard chunk.
   */
  let {
    busy,
    error,
    onPick,
    onClose,
  }: {
    busy: boolean;
    error: string | null;
    onPick: (id: ProjectTemplateId) => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();

</script>

<Modal title={t("projects.templates.title")} wide onClose={() => !busy && onClose()}>
  <Hint>{t("projects.templates.hint")}</Hint>
  <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
    {#each PROJECT_TEMPLATES as template (template.id)}
      {@const tables = Object.keys(template.layout)}
      <button
        type="button"
        class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-primary hover:bg-primary-light/40 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
        disabled={busy}
        onclick={() => onPick(template.id)}
        data-template={template.id}
      >
        <span class="text-[13px] font-bold">{t(TEMPLATE_COPY[template.id].name)}</span>
        <span class="text-xs text-text-muted">{t(TEMPLATE_COPY[template.id].description)}</span>
        <span class="mt-1 flex flex-wrap gap-1">
          {#each tables as table (table)}
            <span class="inline-flex items-center gap-1 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              <Icon icon={TableIcon} size={10} />{table}
            </span>
          {/each}
        </span>
      </button>
    {/each}
  </div>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</Modal>
