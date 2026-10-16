<script lang="ts">
  import type { VariantChange, VariantDecisions } from "@nebuladb/dbml-engine";
  import Modal from "@/components/overlays/Modal.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { ApiError } from "@/services/ApiError";
  import { previewVariantSync, pushToVariants, type VariantSyncResult } from "@/services/variantsApi";

  /**
   * Sending the original's changes to the chosen variants. For each variant,
   * every change the original made since that variant last received it, ticked
   * to be sent; a change the client also made is a conflict, the client's
   * version kept unless "Prendre l'original" is chosen. Nothing changes until
   * "Envoyer".
   */
  let {
    originalId,
    variantIds,
    onClose,
    onDone,
  }: {
    originalId: string;
    variantIds: string[];
    onClose: () => void;
    onDone: () => void;
  } = $props();

  const { t } = useTranslation();
  const preview = useAsyncResource(() => previewVariantSync(originalId, variantIds));
  /** Per variant, per change: what was chosen. Unset: the default (send, or keep the client's for a conflict). */
  let decisions = $state<Record<string, VariantDecisions>>({});
  let results = $state.raw<VariantSyncResult[] | null>(null);

  const takes = (variantId: string, change: VariantChange) =>
    (decisions[variantId]?.[change.key] ?? (change.conflict ? "variant" : "base")) === "base";
  function choose(variantId: string, key: string, value: "base" | "variant") {
    decisions[variantId] = { ...(decisions[variantId] ?? {}), [key]: value };
  }

  const ACTION_TONE = { add: "success", update: "warning", remove: "danger" } as const;

  const send = useAsyncAction(async () => {
    const plans = preview.data ?? [];
    // Every decision is sent in full, so what the server applies is exactly what was shown.
    const targets = plans.map((entry) => ({
      id: entry.id,
      decisions: Object.fromEntries(
        entry.plan.changes.map((change) => [change.key, takes(entry.id, change) ? "base" : "variant"] as const),
      ),
    }));
    results = await pushToVariants(originalId, targets);
    onDone();
  });

  const totalTaken = $derived(
    (preview.data ?? []).reduce((sum, entry) => sum + entry.plan.changes.filter((c) => takes(entry.id, c)).length, 0),
  );
</script>

<Modal title={t("variants.sync.title")} {onClose} wide dismissable={!send.pending}>
  <div class="space-y-4" data-testid="variant-sync">
    {#if results}
      <ul class="m-0 list-none space-y-1.5 p-0" data-testid="variant-sync-results">
        {#each results as result (result.id)}
          <li class="flex items-center gap-2 text-xs">
            <span class="font-semibold">{result.name}</span>
            {#if result.error}
              <span class="text-danger">{describeApiError(new ApiError(400, result.error, result.error), t)}</span>
            {:else}
              <span class="text-text-muted">{t("variants.sync.result", { applied: result.applied, kept: result.kept })}</span>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="flex justify-end border-t border-border pt-4">
        <Button size="sm" variant="primary" onclick={onClose}>{t("common.close")}</Button>
      </div>
    {:else if preview.error}
      <ErrorText>{preview.error}</ErrorText>
    {:else if preview.loading || !preview.data}
      <p class="m-0 text-xs text-text-muted">{t("common.loading")}</p>
    {:else}
      <Hint>{t("variants.sync.hint")}</Hint>
      {#each preview.data as entry (entry.id)}
        <section class="rounded-md border border-border" data-testid="variant-sync-entry">
          <h3 class="m-0 border-b border-border px-3 py-2 text-xs font-semibold">{entry.name}</h3>
          {#if entry.plan.changes.length === 0}
            <p class="m-0 px-3 py-2 text-xs text-text-muted">{t("variants.sync.upToDate")}</p>
          {:else}
            <ul class="m-0 list-none divide-y divide-border/60 p-0">
              {#each entry.plan.changes as change (change.key)}
                <li class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs" data-testid="variant-change">
                  {#if change.conflict}
                    <span class="min-w-0 flex-1">
                      <span class="font-mono">{change.label}</span>
                      <Badge tone={ACTION_TONE[change.action]} class="ml-1">{t(`variants.action.${change.action}`)}</Badge>
                      <Badge tone="danger" class="ml-1">{t("variants.sync.conflict")}</Badge>
                      <span class="block text-[11px] text-text-muted">{t(`variants.sync.${change.conflict}`)}</span>
                    </span>
                    <SegmentedControl
                      size="xs"
                      aria-label={t("variants.sync.choiceFor", { item: change.label })}
                      value={(takes(entry.id, change) ? "base" : "variant") as "base" | "variant"}
                      options={[
                        { value: "variant" as const, label: t("variants.sync.keepClient") },
                        { value: "base" as const, label: t("variants.sync.takeOriginal") },
                      ]}
                      onChange={(value) => choose(entry.id, change.key, value)}
                    />
                  {:else}
                    <Checkbox
                      class="min-w-0 flex-1"
                      checked={takes(entry.id, change)}
                      onChange={(checked) => choose(entry.id, change.key, checked ? "base" : "variant")}
                    >
                      <span class="text-xs">
                        <span class="font-mono">{change.label}</span>
                        <Badge tone={ACTION_TONE[change.action]} class="ml-1">{t(`variants.action.${change.action}`)}</Badge>
                        <span class="ml-1 text-[11px] text-text-muted">{t(`variants.kind.${change.kind}`)}</span>
                      </span>
                    </Checkbox>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
      {#if send.error}<ErrorText>{send.error}</ErrorText>{/if}
      <div class="flex items-center justify-between gap-2 border-t border-border pt-4">
        <span class="text-xs text-text-muted">{t("variants.sync.summary", { count: totalTaken })}</span>
        <div class="flex gap-2">
          <Button size="sm" variant="ghost" onclick={onClose} disabled={send.pending}>{t("common.cancel")}</Button>
          <Button size="sm" variant="primary" onclick={() => void send.run()} disabled={send.pending}>
            {send.pending ? t("common.saving") : t("variants.sync.send")}
          </Button>
        </div>
      </div>
    {/if}
  </div>
</Modal>
