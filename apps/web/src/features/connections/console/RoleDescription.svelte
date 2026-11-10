<script lang="ts">
  import { dbRoleInfo, type DatabaseEngine } from "@nebuladb/shared";
  import Badge from "@/components/ui/Badge.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKey } from "@/i18n/translate";

  /**
   * What a role means, in a sentence, with how far-reaching it is. A built-in
   * role the catalogue knows gets its own explanation; a custom one says where
   * its rights are listed; a built-in one the catalogue does not know says so
   * rather than pretending.
   */
  let {
    engine,
    role,
    system = false,
    showRisk = true,
  }: { engine: DatabaseEngine; role: string; system?: boolean; showRisk?: boolean } = $props();

  const { t } = useTranslation();
  const info = $derived(dbRoleInfo(engine, role));
  const text = $derived(
    info ? t(info.descriptionKey as TranslationKey) : system ? t("dbadmin.role.undocumented") : t("dbadmin.role.custom"),
  );
  const TONE = { low: "success", medium: "warning", high: "danger" } as const;
</script>

<span class="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-text-secondary">
  {#if showRisk && info}<Badge tone={TONE[info.risk]}>{t(`dbadmin.role.risk.${info.risk}`)}</Badge>{/if}
  <span class="min-w-0">{text}</span>
</span>
