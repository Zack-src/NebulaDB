<script lang="ts" module>
  import type { DeploymentReviewStatus } from "@nebuladb/shared";
  import type { BadgeTone } from "@/components/ui/Badge.svelte";

  const STATUS_TONE: Record<DeploymentReviewStatus, BadgeTone> = {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    withdrawn: "muted",
    deployed: "success",
    expired: "muted",
    stale: "muted",
    cancelled: "muted",
  };
  /** How a request ended, when nobody deployed it and its author did not take it back — said for the connection it was for. */
  type EndedStatus = "rejected" | "expired" | "stale" | "cancelled";
  const ENDED: readonly DeploymentReviewStatus[] = ["rejected", "expired", "stale", "cancelled"];
  const ended = (status: DeploymentReviewStatus): status is EndedStatus => ENDED.includes(status);
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { DatabaseConnectionSummary, DeploymentReview } from "@nebuladb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { toast } from "@/components/ui/toast.svelte";
  import DeploymentStageSkip from "@/features/connections/deployment/DeploymentStageSkip.svelte";
  import { STRATEGY_LABEL } from "@/features/connections/deployment/deploymentModel";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { ApiError } from "@/services/ApiError";
  import {
    decideDeploymentReview,
    deployDeploymentReview,
    listDeploymentReviews,
    withdrawDeploymentReview,
  } from "@/services/connectionsApi";

  /**
   * "Revues": the deployments waiting for another person on a stage whose
   * protection is "Revue" — what was frozen (SQL, risks and their answers,
   * the requester's message) and what the reader may do with it: approve or
   * reject someone else's request, deploy an approved one they asked for or
   * approved, withdraw their own. Who may do what is the server's answer
   * (`viewer`), not a guess made here. Nothing is shown while the project has
   * no request to speak of.
   */
  let {
    projectId,
    connections,
    currentId,
    refreshKey = 0,
    canSkipStage = false,
    onDeployed = () => {},
  }: {
    projectId: string;
    /** The project's databases: a request names one, and its stage says whether its name must be retyped. */
    connections: DatabaseConnectionSummary[];
    /** The database the tab is on: how its last request ended is said when it has none open. */
    currentId: string;
    /** Changes when a request was made, decided, closed or deployed. */
    refreshKey?: number;
    canSkipStage?: boolean;
    onDeployed?: () => void;
  } = $props();

  const { t } = useTranslation();
  const reviews = useAsyncResource(() => listDeploymentReviews(projectId));
  let seenKey = untrack(() => refreshKey);
  $effect(() => {
    if (refreshKey !== seenKey) {
      seenKey = refreshKey;
      reviews.reload();
    }
  });

  const open = $derived((reviews.data ?? []).filter((r) => r.status === "pending" || r.status === "approved"));
  /** The current database's last request, when it is closed and ended without a deployment. */
  const lastClosed = $derived.by(() => {
    if (open.some((review) => review.connectionId === currentId)) return null;
    const last = (reviews.data ?? []).find((review) => review.connectionId === currentId);
    return last && ended(last.status) ? { ...last, status: last.status } : null;
  });

  let comments = $state<Record<string, string>>({});
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** The approved request waiting for its production connection's name. */
  let confirming = $state.raw<DeploymentReview | null>(null);
  /** The request the server refused to deploy because an earlier stage does not have the schema yet. */
  let stageBlocked = $state<string | null>(null);
  let skipReason = $state("");

  const connectionOf = (review: DeploymentReview) => connections.find((c) => c.id === review.connectionId);
  const ago = (at: string) => formatRelativeTime(parseServerTime(at), i18n.locale);

  /** Runs one action on a request, then lists again: the server's answer is the state. */
  async function act(review: DeploymentReview, action: () => Promise<unknown>, done?: () => void) {
    busy = review.id;
    error = null;
    try {
      await action();
      stageBlocked = null;
      done?.();
    } catch (err) {
      error = describeApiError(err, t);
      stageBlocked = err instanceof ApiError && err.code === "PIPELINE_STAGE_SKIPPED" ? review.id : null;
    } finally {
      busy = null;
      reviews.reload();
    }
  }

  const decide = (review: DeploymentReview, decision: "approve" | "reject") =>
    act(review, () => decideDeploymentReview(projectId, review.id, decision, comments[review.id]?.trim() || undefined));
  const withdraw = (review: DeploymentReview) => act(review, () => withdrawDeploymentReview(projectId, review.id));

  function deploy(review: DeploymentReview, options: { confirmName?: string; skip?: boolean } = {}) {
    if (connectionOf(review)?.production && options.confirmName === undefined) {
      confirming = review;
      return;
    }
    confirming = null;
    void act(
      review,
      () =>
        deployDeploymentReview(projectId, review.id, {
          confirmName: options.confirmName,
          ...(options.skip ? { skipStageOrder: true, skipReason: skipReason.trim() } : {}),
        }),
      () => {
        toast.success(t("review.deployed", { connection: review.connectionName }));
        skipReason = "";
        onDeployed();
      },
    );
  }
</script>

{#if reviews.error}
  <ErrorText>{reviews.error}</ErrorText>
{:else if open.length > 0 || lastClosed}
  <section
    class="rounded-md border border-border bg-surface p-3 text-xs"
    aria-labelledby="reviews-title"
    data-testid="deployment-reviews"
  >
    <h3 id="reviews-title" class="m-0 mb-2 text-body-sm font-semibold text-text">{t("review.title")}</h3>
    <Hint>{t("review.hint")}</Hint>

    {#if lastClosed}
      <p class="m-0 mt-2 text-text-muted" data-testid="review-last-closed">
        {t(`review.closed.${lastClosed.status}`, {
          connection: lastClosed.connectionName,
          by: lastClosed.decidedByEmail ?? "",
        })}
        {#if lastClosed.closeReason}— {t(`review.reason.${lastClosed.closeReason}`)}{/if}
        {#if lastClosed.comment}<span class="italic text-text"> « {lastClosed.comment} »</span>{/if}
      </p>
    {/if}

    <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0">
      {#each open as review (review.id)}
        {@const pending = busy === review.id}
        <li
          class="rounded-sm border border-border bg-surface-raised p-2.5"
          data-review={review.connectionName}
          data-status={review.status}
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-text">{review.connectionName}</span>
            {#if review.environment}<Badge tone="muted">{review.environment}</Badge>{/if}
            <Badge tone={STATUS_TONE[review.status]}>{t(`review.status.${review.status}`)}</Badge>
            <span class="flex-1"></span>
            <span class="text-text-muted">
              {t("review.requestedBy", { email: review.requestedByEmail, when: ago(review.requestedAt) })}
            </span>
          </div>
          {#if review.message}<p class="m-0 mt-1.5 italic text-text">« {review.message} »</p>{/if}
          {#if review.status === "approved" && review.decidedByEmail}
            <p class="m-0 mt-1.5 text-text-muted">
              {t("review.approvedBy", { email: review.decidedByEmail })}
              {#if review.expiresAt}
                · {t("review.expires", { when: formatDateTime(parseServerTime(review.expiresAt), i18n.locale) })}
              {/if}
              {#if review.comment}<span class="italic text-text"> « {review.comment} »</span>{/if}
            </p>
          {/if}
          {#if review.schemaChanged}
            <p class="m-0 mt-1.5 text-warning" role="status">{t("review.schemaChanged")}</p>
          {/if}

          {#if review.risks.length > 0}
            <div class="mt-2 text-[11px]">
              <span class="mb-1 block font-semibold text-text">{t("review.risks")}</span>
              <ul class="m-0 list-none space-y-0.5 p-0">
                {#each review.risks as risk, index (index)}
                  <li class="text-text-muted">
                    <span class="font-mono text-text">
                      {risk.columnName ? `${risk.tableName}.${risk.columnName}` : (risk.detail ?? risk.tableName)}
                    </span>
                    · {t(`deployment.riskType.${risk.type}`)}
                    {#if !risk.unmeasured && risk.affectedRowCount > 0}({risk.affectedRowCount}
                      {t("deployment.rowsAffected")}){/if}
                    → {t(STRATEGY_LABEL[risk.strategy])}
                  </li>
                {/each}
              </ul>
              {#if review.riskNote}<p class="m-0 mt-1 italic text-text">« {review.riskNote} »</p>{/if}
            </div>
          {/if}
          {#if review.skipSeeds}<p class="m-0 mt-1.5 text-text-muted">{t("review.skipSeeds")}</p>{/if}

          <details class="mt-2" open={review.viewer.canDecide}>
            <summary class="cursor-pointer font-semibold text-text-muted">{t("review.sql")}</summary>
            <textarea
              readonly
              class={`${TEXTAREA_CODE_CLASS} mt-1 h-40 w-full`}
              aria-label={t("review.sql")}
              value={review.sql}
            ></textarea>
          </details>

          <div class="mt-2 flex flex-wrap items-center gap-2">
            {#if review.viewer.canDecide}
              <input
                class={`${INPUT_SM_CLASS} min-w-[200px] flex-1`}
                placeholder={t("review.commentPlaceholder")}
                aria-label={t("review.comment")}
                maxlength={1000}
                bind:value={comments[review.id]}
              />
              <Button size="sm" variant="outline" disabled={pending} onclick={() => void decide(review, "reject")}>
                {t("review.reject")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={pending || review.schemaChanged}
                onclick={() => void decide(review, "approve")}
              >
                {t("review.approve")}
              </Button>
            {:else if review.status === "pending"}
              <span class="flex-1 text-text-muted">{t("review.waiting")}</span>
            {:else}
              <span class="flex-1"></span>
            {/if}
            {#if review.viewer.canWithdraw}
              <Button size="sm" variant="ghost" disabled={pending} onclick={() => void withdraw(review)}>
                {t("review.withdraw")}
              </Button>
            {/if}
            {#if review.viewer.canDeploy}
              <Button size="sm" variant="primary" disabled={pending} onclick={() => deploy(review)}>
                {pending ? t("deployment.deploying") : t("review.deploy")}
              </Button>
            {/if}
          </div>
          {#if stageBlocked === review.id && canSkipStage && review.viewer.canDeploy}
            <DeploymentStageSkip
              bind:skipReason
              deploying={pending}
              onSkip={() => deploy(review, { skip: true })}
            />
          {/if}
        </li>
      {/each}
    </ul>
    {#if error}<ErrorText>{error}</ErrorText>{/if}
  </section>
{/if}

{#if confirming}
  {@const review = confirming}
  <ConfirmDialog
    title={t("environments.deployTitle", { name: review.connectionName })}
    message={t("environments.deployMessage", { environment: review.environment ?? "" })}
    danger="danger"
    requireText={review.connectionName}
    confirmLabel={t("review.deploy")}
    onCancel={() => (confirming = null)}
    onConfirm={() => deploy(review, { confirmName: review.connectionName, skip: stageBlocked === review.id })}
  />
{/if}
