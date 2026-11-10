<script lang="ts">
  import PageIntro from "@/components/layout/PageIntro.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchSecurityPolicy, saveSecurityPolicy } from "@/services/securityApi";

  /** Instance-wide sign-in rules. Saved the moment a switch changes. */
  const { t } = useTranslation();

  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let require2fa = $state(false);

  $effect(() => {
    fetchSecurityPolicy()
      .then((policy) => {
        require2fa = policy.require2fa;
        loaded = true;
      })
      .catch((err: unknown) => (loadError = err instanceof Error ? err.message : String(err)));
  });

  const save = useAsyncAction(async (next: boolean) => {
    try {
      require2fa = (await saveSecurityPolicy({ require2fa: next })).require2fa;
      toast.success(t("admin.security.saved"));
    } catch (err) {
      require2fa = !next;
      throw err;
    }
  });
</script>

<div class="space-y-4" data-testid="security-settings">
  <PageIntro>{t("admin.security.hint")}</PageIntro>
  {#if loadError}<ErrorText>{loadError}</ErrorText>{/if}
  {#if loaded}
    <Checkbox
      bind:checked={require2fa}
      disabled={save.pending}
      hint={t("admin.security.require2faHint")}
      onChange={(next) => void save.run(next)}
    >
      <span class="text-xs">{t("admin.security.require2fa")}</span>
    </Checkbox>
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
  {/if}
</div>
