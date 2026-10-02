<script lang="ts">
  import type { DbAdminStatementsResult } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The one way the console changes anything on a target server: show the exact
   * SQL first (the server builds it, secrets masked), run it only on a second,
   * explicit click. Destructive actions add typing the object's name — the
   * buttons that lead here sit one row apart from harmless ones.
   */
  let {
    title,
    hint,
    confirmName,
    danger = false,
    run,
    onDone,
    onClose,
  }: {
    title: string;
    hint?: string;
    /** When set, the action only unlocks once this exact name has been typed. */
    confirmName?: string;
    danger?: boolean;
    /** `execute: false` returns the preview; `true` runs it. `confirmation` is what was typed. */
    run: (execute: boolean, confirmation?: string) => Promise<DbAdminStatementsResult>;
    onDone: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let confirmation = $state("");
  const preview = useAsyncResource(() => run(false));
  const confirmed = $derived(confirmName === undefined || confirmation === confirmName);
  const execute = useAsyncAction(async () => {
    await run(true, confirmation);
    onDone();
  });
</script>

<Modal {title} {onClose} dismissable={!execute.pending}>
  {#if hint}<Hint>{hint}</Hint>{/if}
  <div class="mb-1 text-xs font-semibold text-text-secondary">{t("dbadmin.statement.preview")}</div>
  <pre
    class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-raised p-2.5 font-mono text-[12px] leading-normal text-text">{preview.loading
      ? t("common.loading")
      : (preview.data?.sql ?? []).map((line) => `${line};`).join("\n")}</pre>
  {#if preview.error}<ErrorText>{preview.error}</ErrorText>{/if}

  {#if confirmName !== undefined && preview.data}
    <label class="mt-4 block text-xs font-semibold text-text-secondary">
      {t("dbadmin.statement.typeToConfirm")} <span class="font-mono text-text">{confirmName}</span>
      <input class={`${INPUT_CLASS} mt-1 w-full`} bind:value={confirmation} use:autofocus autocomplete="off" />
    </label>
  {/if}

  <div class="mt-4 flex items-center justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onClose} disabled={execute.pending}>{t("common.cancel")}</Button>
    <Button
      variant={danger ? "danger" : "primary"}
      size="sm"
      onclick={() => void execute.run()}
      disabled={!preview.data || !confirmed || execute.pending}
    >
      {execute.pending ? t("dbadmin.statement.executing") : t("dbadmin.statement.execute")}
    </Button>
  </div>
  {#if execute.error}<ErrorText>{execute.error}</ErrorText>{/if}
</Modal>
