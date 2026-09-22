<script lang="ts" module>
  import type { McdWarning } from "@athanordb/shared";
  import type { TranslationKeyOf } from "@/types";

  const REASON_KEY: Record<McdWarning["reason"], TranslationKeyOf> = {
    "possible-ternary-association": "mcd.warning.ternary",
    "ambiguous-junction-table": "mcd.warning.ambiguousJunction",
  };
</script>

<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Lists the tables `deriveMCD` couldn't cleanly fold into an association —
   * shown up front rather than silently, so a schema with a real ternary
   * relationship (or a junction table that got an extra column added
   * inconsistently) doesn't quietly read as "fully modeled" when it isn't.
   */
  let { warnings }: { warnings: McdWarning[] } = $props();

  const { t } = useTranslation();
</script>

<div
  class="absolute left-1/2 top-3 z-10 max-w-[520px] -translate-x-1/2 rounded-sm border border-warning bg-surface px-3 py-2 text-[12px] text-text shadow-md"
>
  <div class="mb-1 font-semibold text-warning">{t("mcd.warning.title")}</div>
  <ul class="flex flex-col gap-0.5">
    {#each warnings as w (w.tableId)}
      <li class="text-text-secondary">
        <span class="font-mono text-text">{w.tableName}</span> — {t(REASON_KEY[w.reason])}
      </li>
    {/each}
  </ul>
</div>
