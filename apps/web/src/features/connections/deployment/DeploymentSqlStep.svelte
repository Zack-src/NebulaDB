<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import { INPUT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Third step of the deployment dialog: the SQL that will run, and what is
   * asked just before applying it — why data loss is accepted, whether to
   * back the database up first — plus the reminder that a risk answered
   * "cancel" blocks the deployment.
   */
  let {
    sql,
    readOnly,
    losesData,
    riskNote = $bindable(),
    backupBefore,
    onBackupChange,
    blockingRiskCount,
    copied,
    onCopy,
  }: {
    /** The SQL with the answers given so far. */
    sql: string;
    readOnly: boolean;
    /** One of the chosen strategies loses data: ask why it is accepted. */
    losesData: boolean;
    riskNote: string;
    backupBefore: boolean;
    onBackupChange: (checked: boolean) => void;
    blockingRiskCount: number;
    copied: boolean;
    onCopy: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<!-- Step 3: SQL Preview -->
<div class="space-y-2">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold text-text-muted">{t("deployment.generatedSqlScript")}</span>
    <Button size="xs" variant="ghost" onclick={onCopy}>
      {copied ? t("common.copied") : t("common.copy")}
    </Button>
  </div>
  <textarea
    readonly
    class={`${TEXTAREA_CODE_CLASS} h-72 w-full`}
    value={sql}
  ></textarea>
  {#if losesData && !readOnly}
    <label class="block pt-1 text-xs text-text">
      <span class="mb-1 block font-semibold">{t("deployment.riskNote")}</span>
      <textarea
        class={`${INPUT_CLASS} h-14 w-full`}
        bind:value={riskNote}
        maxlength={1000}
        placeholder={t("deployment.riskNotePlaceholder")}
      ></textarea>
    </label>
  {/if}
  {#if !readOnly}
    <Checkbox checked={backupBefore} onChange={onBackupChange} hint={t("deployment.backupBeforeHint")}>
      <span class="text-xs">{t("deployment.backupBefore")}</span>
    </Checkbox>
  {/if}
  {#if blockingRiskCount > 0}
    <p class="text-xs text-danger" role="alert">{t("deployment.blockedByCancel", { count: blockingRiskCount })}</p>
  {/if}
</div>
