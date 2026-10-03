<script lang="ts" module>
  import type { StructuralAction } from "@athanordb/shared";
  import type { Translator } from "@/i18n/serverErrorMessages";

  /** "supprimer la table orders", "modifier la table orders (colonne note)" — shared with the `warn` confirmation. */
  export function describeStructuralAction(action: StructuralAction, t: Translator): string {
    const what = t(`dbadmin.structure.action.${action.verb}.${action.kind}`, {
      object: action.object ?? t("dbadmin.structure.unnamed"),
    });
    return action.column ? t("dbadmin.structure.withColumn", { action: what, column: action.column }) : what;
  }
</script>

<script lang="ts">
  import type { StructurePolicyRefusal } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, ChevronRightIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { useWorkspace } from "@/features/workspace/workspaceContext";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Shown instead of running a structural change on a database a project
   * models: says what was attempted, why it is not done here, and takes the
   * user to the schema that owns it — with the table already in view.
   *
   * The links are plain URLs (`/project/:id?table=…`), so they work from the
   * admin console — which knows nothing of the app's routing state — and can
   * be opened in a new tab. When the console is a tab of that very project's
   * workspace, a plain click is instead a change of tab, with no reload.
   */
  let { refusal, onClose }: { refusal: StructurePolicyRefusal; onClose: () => void } = $props();

  const { t } = useTranslation();
  const workspace = useWorkspace();

  // The first named table is the one worth landing on.
  const focus = $derived(refusal.actions.find((action) => action.kind === "table" && action.object));

  function projectUrl(projectId: string): string {
    if (!focus?.object) return `/project/${projectId}`;
    const query = new URLSearchParams({ table: focus.object.split(".").pop()! });
    if (focus.column) query.set("field", focus.column);
    return `/project/${projectId}?${query}`;
  }

  function openInWorkspace(event: MouseEvent, projectId: string) {
    // A modified click means "open elsewhere": leave that to the browser.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    if (!workspace?.openInSchema(projectId, focus?.object?.split(".").pop(), focus?.column)) return;
    event.preventDefault();
    onClose();
  }
</script>

<Modal title={t("dbadmin.structure.redirectTitle")} {onClose} narrow>
  <div class="flex flex-col gap-3 text-body text-text-secondary">
    <div class="flex items-start gap-2.5">
      <Icon icon={AlertTriangleIcon} size={16} class="mt-0.5 shrink-0 text-warning" />
      <p class="m-0 leading-relaxed">
        {t("dbadmin.structure.redirectIntro", { count: refusal.projects.length, project: refusal.projects[0]?.name ?? "" })}
      </p>
    </div>

    <div>
      <div class="mb-1 text-label font-medium text-text-muted">{t("dbadmin.structure.attempted")}</div>
      <ul class="m-0 list-disc space-y-0.5 pl-5 text-text">
        {#each refusal.actions as action, index (index)}
          <li>{describeStructuralAction(action, t)}</li>
        {/each}
      </ul>
    </div>

    <p class="m-0 leading-relaxed">{t("dbadmin.structure.redirectWhy")}</p>

    <div class="flex flex-col gap-1.5 border-t border-border pt-3">
      {#each refusal.projects as project (project.id)}
        <a
          href={projectUrl(project.id)}
          onclick={(event) => openInWorkspace(event, project.id)}
          class="flex h-8 items-center justify-between gap-2 rounded-md border border-primary bg-primary px-3 text-body font-semibold text-white no-underline transition-colors duration-fast hover:border-primary-hover hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span class="truncate">{t("dbadmin.structure.openInSchema", { project: project.name })}</span>
          <Icon icon={ChevronRightIcon} size={14} class="shrink-0" />
        </a>
      {/each}
      <Button variant="ghost" size="sm" class="self-end" onclick={onClose}>{t("common.cancel")}</Button>
    </div>
  </div>
</Modal>
