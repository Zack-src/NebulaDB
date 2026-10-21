<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import Button from "@/components/ui/Button.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Shown to an instance administrator once the server refused a deployment
   * because an earlier pipeline stage does not have this schema yet: a
   * reason to give, and the button that deploys anyway.
   */
  let {
    skipReason = $bindable(),
    deploying,
    onSkip,
  }: {
    skipReason: string;
    deploying: boolean;
    onSkip: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<div class="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="stage-skip">
  <Input inputSize="sm"
    class="min-w-[220px] flex-1"
    placeholder={t("pipeline.skipReasonPlaceholder")}
    aria-label={t("pipeline.skipReason")}
    maxlength={300}
    bind:value={skipReason}
  />
  <Button size="sm" variant="danger" disabled={deploying || !skipReason.trim()} onclick={onSkip}>
    {t("pipeline.skipAndDeploy")}
  </Button>
</div>
