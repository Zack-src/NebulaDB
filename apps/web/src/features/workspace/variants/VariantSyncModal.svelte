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
  import {
    previewVariantSync,
    pushToVariants,
    type VariantSyncDirection,
    type VariantSyncResult,
  } from "@/services/variantsApi";

  /**
   * Sending the original's changes to the chosen variants (`push`), or
   * bringing the variants' changes into the original (`pull`). For each
   * variant, every change the source made since they last agreed, ticked to be
   * taken; a change the receiving side also made is a conflict, its version
   * kept unless the source's is chosen. Schema and initial data (seeds) are
   * listed together. Column properties can be left as the receiving side has
   * them (typically `type`, for a variant on another engine). Nothing changes
   * until the button at the bottom is pressed.
   */
  let {
    originalId,
    variantIds,
    direction = "push",
    onClose,
    onDone,
  }: {
    originalId: string;
    variantIds: string[];
    direction?: VariantSyncDirection;
    onClose: () => void;
    onDone: () => void;
  } = $props();

  const { t } = useTranslation();
  function propLabel(prop: string): string {
    switch (prop) {
      case "type":
        return t("variants.prop.type");
      case "default":
        return t("variants.prop.default");
      case "notNull":
        return t("variants.prop.notNull");
      case "unique":
        return t("variants.prop.unique");
      case "note":
        return t("variants.prop.note");
      case "name":
        return t("variants.prop.name");
      case "pk":
        return t("variants.prop.pk");
      case "increment":
        return t("variants.prop.increment");
      case "defaultKind":
        return t("variants.prop.defaultKind");
      default:
        return prop;
    }
  }
  const pull = $derived(direction === "pull");
  /** Column properties left as the receiving side has them. Types by default: a variant is often on another engine. */
  const KEEPABLE = ["type", "default", "notNull", "unique", "note"] as const;
  let keep = $state<string[]>(["type"]);
  const preview = useAsyncResource(() =>
    previewVariantSync(originalId, variantIds, { direction, ignoreFieldProps: [...keep] }),
  );
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
    results = await pushToVariants(originalId, targets, { direction, ignoreFieldProps: [...keep] });
    onDone();
  });

  const totalTaken = $derived(
    (preview.data ?? []).reduce((sum, entry) => sum + entry.plan.changes.filter((c) => takes(entry.id, c)).length, 0),
  );
</script>

{#snippet propBadges(change: VariantChange)}
  {#if change.props && change.props.length > 0}
    {#each change.props as prop (prop)}
      <Badge tone="muted" class="ml-1">{propLabel(prop)}</Badge>
    {/each}
  {/if}
{/snippet}

{#snippet keepOptions()}
  <fieldset class="m-0 rounded-md border border-border px-3 py-2" data-testid="variant-sync-keep">
    <legend class="px-1 text-caption text-text-muted">{t("variants.sync.keepLegend")}</legend>
    <div class="flex flex-wrap gap-x-4 gap-y-1">
      {#each KEEPABLE as prop (prop)}
        <Checkbox
          checked={keep.includes(prop)}
          disabled={send.pending}
          onChange={(checked) => (keep = checked ? [...keep, prop] : keep.filter((p) => p !== prop))}
        >
          <span class="text-xs">{propLabel(prop)}</span>
        </Checkbox>
      {/each}
    </div>
  </fieldset>
{/snippet}

<Modal title={pull ? t("variants.sync.titlePull") : t("variants.sync.title")} {onClose} wide dismissable={!send.pending}>
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
      {@render keepOptions()}
      <p class="m-0 text-xs text-text-muted">{t("common.loading")}</p>
    {:else}
      <Hint>{pull ? t("variants.sync.hintPull") : t("variants.sync.hint")}</Hint>
      {@render keepOptions()}
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
                      <span class="ml-1 text-caption text-text-muted">{t(`variants.kind.${change.kind}`)}</span>
                      {@render propBadges(change)}
                      <span class="block text-caption text-text-muted">
                        {t(`variants.sync.${change.conflict}${pull ? "Pull" : ""}`)}
                      </span>
                    </span>
                    <SegmentedControl
                      size="xs"
                      aria-label={t("variants.sync.choiceFor", { item: change.label })}
                      value={(takes(entry.id, change) ? "base" : "variant") as "base" | "variant"}
                      options={[
                        {
                          value: "variant" as const,
                          label: pull ? t("variants.sync.keepOriginal") : t("variants.sync.keepClient"),
                        },
                        {
                          value: "base" as const,
                          label: pull ? t("variants.sync.takeClient") : t("variants.sync.takeOriginal"),
                        },
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
                        <span class="ml-1 text-caption text-text-muted">{t(`variants.kind.${change.kind}`)}</span>
                        {@render propBadges(change)}
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
            {send.pending ? t("common.saving") : pull ? t("variants.sync.pull") : t("variants.sync.send")}
          </Button>
        </div>
      </div>
    {/if}
  </div>
</Modal>
