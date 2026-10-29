<script lang="ts">
  import ProgressBar from "@/components/ui/ProgressBar.svelte";
  import { useDelayedFlag } from "@/hooks/delayedFlag.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * How far a big schema is from having its columns drawn, shown only when that takes long: on a fast
   * machine the schema is complete in about a second and nothing shows; on a slow one the bar says the
   * editor is working rather than stuck.
   */
  let { working, progress }: { working: boolean; /** 0 to 1 */ progress: number } = $props();

  /** Slower than this and the user starts to wonder. */
  const SHOW_AFTER_MS = 1500;

  const { t } = useTranslation();
  const shown = useDelayedFlag(() => working, { delayMs: SHOW_AFTER_MS });
</script>

{#if shown.visible}
  <div class="pointer-events-none absolute inset-x-0 top-0 z-10" data-testid="opening-progress">
    <ProgressBar value={progress * 100} label={t("editor.opening.columns")} />
    <div
      class="absolute right-3 top-2 rounded-sm bg-surface/90 px-2 py-0.5 text-caption text-text-muted shadow-sm"
      aria-hidden="true"
    >
      {t("editor.opening.columns")} {Math.round(progress * 100)} %
    </div>
  </div>
{/if}
