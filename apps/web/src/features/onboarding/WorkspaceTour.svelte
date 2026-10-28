<script lang="ts" module>
  const CARD_WIDTH = 340;
  const MARGIN = 12;
  const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  /** The first matching element that is actually on screen — the palette button exists in more than one bar. */
  function visibleTarget(selector: string): DOMRect | null {
    for (const element of document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return box;
    }
    return null;
  }
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import { useEscapeKey } from "@/hooks/escapeKey.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { shortcutLabel, type TourStep } from "./tourSteps";

  /**
   * The workspace's guided tour: a few short steps, each pointing at the tab or
   * the control it talks about. Shown once per browser on the first project
   * opened, and again on request. It never blocks the editor: no scrim, and
   * everything stays clickable around the card.
   */
  let { steps, onClose }: { steps: readonly TourStep[]; onClose: () => void } = $props();

  const { t } = useTranslation();
  let index = $state(0);
  const step = $derived(steps[index]);
  const last = $derived(index === steps.length - 1);

  /** The target's box, re-read on resize and while panels settle; `null` when it is not on screen. */
  let rect = $state.raw<DOMRect | null>(null);
  $effect(() => {
    const { selector } = step;
    const measure = () => (rect = visibleTarget(selector));
    measure();
    const timer = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  });

  // The card sits under its target, or in the middle of the window when there is nothing to point at.
  const cardStyle = $derived.by(() => {
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * MARGIN);
    if (!rect) return `left: ${(window.innerWidth - width) / 2}px; top: 30vh; width: ${width}px`;
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    return `left: ${left}px; top: ${rect.bottom + MARGIN}px; width: ${width}px`;
  });

  useEscapeKey(
    () => true,
    () => onClose(),
  );
</script>

{#if rect}
  <div
    class="pointer-events-none fixed z-[900] rounded-md ring-2 ring-primary ring-offset-2 ring-offset-transparent"
    style={`left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; height: ${rect.height}px`}
    aria-hidden="true"
    data-testid="tour-highlight"
  ></div>
{/if}

<div
  class="fixed z-[900] rounded-md border border-border-strong bg-surface-raised p-4 text-body-sm text-text shadow-lg"
  style={cardStyle}
  role="dialog"
  aria-labelledby="tour-title"
  data-testid="tour"
  data-step={step.id}
>
  <p class="m-0 text-caption font-semibold uppercase text-text-muted">
    {t("tour.progress", { current: index + 1, total: steps.length })}
  </p>
  <h2 id="tour-title" class="m-0 mt-1 text-heading font-semibold">{t(`tour.${step.id}.title`)}</h2>
  <p class="m-0 mt-2 text-text-secondary">
    {t(`tour.${step.id}.body`, { shortcut: shortcutLabel(step.id === "sql" ? "Ctrl+J" : "Ctrl+K", IS_MAC) })}
  </p>
  <div class="mt-3 flex items-center gap-2">
    <Button size="sm" variant="ghost" onclick={onClose}>{t("tour.skip")}</Button>
    <span class="flex-1"></span>
    {#if index > 0}
      <Button size="sm" variant="outline" onclick={() => (index -= 1)}>{t("tour.previous")}</Button>
    {/if}
    {#if last}
      <Button size="sm" variant="primary" onclick={onClose}>{t("tour.done")}</Button>
    {:else}
      <Button size="sm" variant="primary" onclick={() => (index += 1)}>{t("tour.next")}</Button>
    {/if}
  </div>
</div>
