<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { LayersIcon, TableIcon, UploadIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import TemplatePickerModal from "@/features/projects/templates/TemplatePickerModal.svelte";
  import { projectTemplateSource, type ProjectTemplateId } from "@/features/projects/templates/projectTemplates";
  import { importSource } from "@/services/projectsApi";

  /**
   * What an empty canvas offers instead of a blank screen: add a table, import
   * what already exists, or start from a template. Floats over the canvas but
   * lets the pointer through everywhere except on its own card, so the canvas
   * (right-click menu, shortcuts) stays usable behind it.
   */
  let {
    projectId,
    onAddTable,
    onImport,
  }: {
    projectId: string;
    onAddTable: () => void;
    onImport: () => void;
  } = $props();

  const { t } = useTranslation();
  let pickerOpen = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function applyTemplate(id: ProjectTemplateId) {
    busy = true;
    error = null;
    try {
      await importSource(projectId, projectTemplateSource(id));
      pickerOpen = false;
    } catch (err) {
      error = describeApiError(err, t);
    } finally {
      busy = false;
    }
  }
</script>

<div class="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center p-4" data-testid="empty-canvas">
  <div class="pointer-events-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-surface-raised p-6 text-center shadow-md">
    <div>
      <h2 class="m-0 text-heading font-semibold text-text">{t("editor.empty.title")}</h2>
      <p class="m-0 mt-1 text-body text-text-muted">{t("editor.empty.body")}</p>
    </div>
    <div class="flex flex-wrap justify-center gap-2">
      <Button variant="primary" onclick={onAddTable} class="gap-2 text-label">
        <Icon icon={TableIcon} size={14} />
        {t("editor.empty.addTable")}
      </Button>
      <Button onclick={onImport} class="gap-2 text-label">
        <Icon icon={UploadIcon} size={14} />
        {t("editor.empty.import")}
      </Button>
      <Button
        onclick={() => {
          error = null;
          pickerOpen = true;
        }}
        class="gap-2 text-label"
      >
        <Icon icon={LayersIcon} size={14} />
        {t("projects.fromTemplate")}
      </Button>
    </div>
  </div>
</div>

{#if pickerOpen}
  <TemplatePickerModal {busy} {error} onPick={(id) => void applyTemplate(id)} onClose={() => (pickerOpen = false)} />
{/if}
