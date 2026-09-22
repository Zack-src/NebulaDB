<script lang="ts">
  import { untrack } from "svelte";
  import type { Project, RevisionMeta } from "@athanordb/shared";
  import { diffProjects, type ProjectDiff } from "@athanordb/dbml-engine";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    exportRevisionDbml,
    fetchRevisionProject,
    fetchRevisions,
    labelRevision,
    restoreRevision,
  } from "@/services/projectsApi";
  import DiffSummary from "./DiffSummary.svelte";

  /**
   * Revision timeline: list of past revisions (author + timestamp), DBML preview
   * of whichever one is selected, a schema-level diff against the current live
   * state (`diffProjects` — safe client-side, unlike `dbml.ts`'s exports, since
   * it has no `@dbml/core` import to drag in), and a restore button hitting the
   * non-destructive restore endpoint (creates a new revision rather than
   * rewriting history).
   */
  let { projectId, currentProject, onClose }: { projectId: string; currentProject: Project; onClose: () => void } =
    $props();

  const { t } = useTranslation();
  let revisions = $state.raw<RevisionMeta[]>([]);
  let selectedId = $state<string | null>(null);
  let preview = $state("");
  let diff = $state.raw<ProjectDiff | null>(null);
  let loadingPreview = $state(false);
  let error = $state<string | null>(null);
  let labelInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    fetchRevisions(projectId)
      .then((loaded) => {
        revisions = loaded as RevisionMeta[];
        if (loaded.length > 0) selectedId = loaded[loaded.length - 1].id;
      })
      .catch((err: unknown) => (error = describeApiError(err, t)));
  });

  $effect(() => {
    const id = selectedId;
    const pid = projectId;
    if (!id) return;
    loadingPreview = true;
    Promise.all([exportRevisionDbml(pid, id), fetchRevisionProject(pid, id)])
      .then(([dbml, revisionProject]) => {
        preview = dbml;
        // `currentProject` deliberately untracked: it's a new object on every
        // doc change, and re-diffing on every remote edit while the panel is
        // open would be noisy — the comparison point is "this revision vs.
        // what was on screen when I picked it".
        diff = diffProjects(revisionProject, untrack(() => currentProject));
      })
      .catch((err: unknown) => (error = describeApiError(err, t)))
      .finally(() => (loadingPreview = false));
  });

  const saveLabel = useAsyncAction(async () => {
    if (!selectedId || !labelInput) return;
    const id = selectedId;
    const label = labelInput.value.trim() || null;
    await labelRevision(projectId, id, label);
    revisions = revisions.map((rev) => (rev.id === id ? { ...rev, label } : rev));
  });

  const restore = useAsyncAction(async () => {
    if (!selectedId) return;
    await restoreRevision(projectId, selectedId);
    onClose();
  });

  const loadingLabel = $derived(t("common.loading"));
  const shownError = $derived(error ?? saveLabel.error ?? restore.error);
</script>

<Modal title={t("history.title")} {onClose} wide>
  <div class="flex h-[440px]">
    <ul class="w-[210px] shrink-0 list-none overflow-y-auto border-r border-border p-1.5 m-0">
      {#each revisions as revision (revision.id)}
        <li>
          <button
            class={`mb-0.5 block w-full rounded-sm px-[9px] py-2 text-left transition-colors duration-100 hover:bg-surface-hover ${
              revision.id === selectedId ? "!bg-primary-light" : ""
            }`}
            onclick={() => (selectedId = revision.id)}
          >
            <div
              class="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold text-text"
            >
              {revision.label ? `🏷 ${revision.label}` : revision.author}
            </div>
            <div class="mt-px text-[11px] text-text-muted">
              {revision.label
                ? `${revision.author} · ${formatDateTime(revision.createdAt, i18n.locale)}`
                : formatDateTime(revision.createdAt, i18n.locale)}
            </div>
          </button>
        </li>
      {/each}
      {#if revisions.length === 0}<li class="p-2 text-xs text-text-muted">{t("history.empty")}</li>{/if}
    </ul>
    <div class="flex min-w-0 flex-1 flex-col px-3.5 py-3">
      <div class="mb-2.5 flex items-center justify-between gap-2">
        <div class="flex flex-1 gap-1.5">
          {#key selectedId}
            <input
              bind:this={labelInput}
              class={`${INPUT_CLASS} flex-1`}
              value={untrack(() => revisions.find((revision) => revision.id === selectedId)?.label ?? "")}
              placeholder={t("history.labelPlaceholder")}
              disabled={!selectedId}
            />
          {/key}
          <Button size="sm" onclick={() => void saveLabel.run()} disabled={!selectedId || saveLabel.pending}>
            {saveLabel.pending ? t("common.saving") : t("history.label")}
          </Button>
        </div>
        <Button variant="primary" size="sm" onclick={() => void restore.run()} disabled={!selectedId || restore.pending}>
          {restore.pending ? t("history.restoring") : t("history.restore")}
        </Button>
      </div>
      <div
        class="mb-2.5 max-h-[120px] overflow-y-auto rounded-sm border border-border bg-[var(--color-bg-canvas)] px-2.5 py-2"
      >
        <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
          {t("history.changesSince")}
        </div>
        {#if loadingPreview}
          <div class="text-xs text-text-muted">{loadingLabel}</div>
        {:else if diff}
          <DiffSummary {diff} />
        {/if}
      </div>
      <textarea readonly class={`${TEXTAREA_CODE_CLASS} flex-1`} value={loadingPreview ? loadingLabel : preview}></textarea>
    </div>
  </div>
  {#if shownError}<ErrorText>{shownError}</ErrorText>{/if}
</Modal>
