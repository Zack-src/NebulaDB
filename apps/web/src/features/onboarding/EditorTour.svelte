<script lang="ts" module>
  import { readBoolean, writeBoolean } from "@/utils/storage";

  const SEEN_KEY = "athanordb.tour.editor.seen";

  /** Whether this browser has already been shown the editor's tour (finished or skipped). */
  export const editorTourSeen = () => readBoolean(SEEN_KEY, false);
  export const markEditorTourSeen = () => writeBoolean(SEEN_KEY, true);

  interface TourStep {
    id: "canvas" | "dbml" | "toolbar" | "shortcuts" | "workspace";
    /** What the step points at; when it is not on screen (a closed panel) the card stands alone. */
    selector: string;
    /** Point at the matched element's parent — for a container that has no handle of its own. */
    parent?: boolean;
  }

  const STEPS: readonly TourStep[] = [
    { id: "canvas", selector: ".svelte-flow" },
    { id: "dbml", selector: ".cm-editor" },
    { id: "toolbar", selector: '[data-testid="toggle-link-highlight"]', parent: true },
    { id: "shortcuts", selector: ".svelte-flow" },
    { id: "workspace", selector: '[role="tablist"]' },
  ];

  /** Key names, not prose — never translated. `Ctrl` reads `⌘` on a Mac keyboard. */
  const SHORTCUTS: readonly { keys: string; label: "search" | "duplicate" | "copyPaste" | "undo" | "delete" }[] = [
    { keys: "Ctrl+F", label: "search" },
    { keys: "Ctrl+D", label: "duplicate" },
    { keys: "Ctrl+C / Ctrl+V", label: "copyPaste" },
    { keys: "Ctrl+Z / Ctrl+Y", label: "undo" },
    { keys: "Suppr / Delete", label: "delete" },
  ];

  const CARD_WIDTH = 340;
  const MARGIN = 12;
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import { useEscapeKey } from "@/hooks/escapeKey.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The editor's guided tour: five short steps, each pointing at the part of
   * the screen it talks about. Shown once per browser, the first time a
   * project is opened, and again on request. It never blocks the editor —
   * there is no scrim, and everything stays clickable around the card.
   */
  let { onClose }: { onClose: () => void } = $props();

  const { t } = useTranslation();
  let index = $state(0);
  const step = $derived(STEPS[index]);
  const last = $derived(index === STEPS.length - 1);

  /** The target's box, re-read on resize and while panels settle; `null` when it is not on screen. */
  let rect = $state.raw<DOMRect | null>(null);
  $effect(() => {
    const { selector, parent } = step;
    const measure = () => {
      const found = document.querySelector(selector);
      const target = parent ? found?.parentElement : found;
      const box = target?.getBoundingClientRect();
      rect = box && box.width > 0 && box.height > 0 ? box : null;
    };
    measure();
    const timer = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  });

  // The card sits under a small target, over the middle of a large one, and
  // in the middle of the window when there is nothing to point at.
  const cardStyle = $derived.by(() => {
    const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * MARGIN);
    if (!rect) return `left: ${(window.innerWidth - width) / 2}px; top: 30vh; width: ${width}px`;
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    if (rect.height > window.innerHeight * 0.45) {
      return `left: ${left}px; top: ${rect.top + rect.height * 0.3}px; width: ${width}px`;
    }
    return rect.top > window.innerHeight / 2
      ? `left: ${left}px; bottom: ${window.innerHeight - rect.top + MARGIN}px; width: ${width}px`
      : `left: ${left}px; top: ${rect.bottom + MARGIN}px; width: ${width}px`;
  });

  function finish() {
    markEditorTourSeen();
    onClose();
  }
  useEscapeKey(() => true, finish);
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
    {t("tour.progress", { current: index + 1, total: STEPS.length })}
  </p>
  <h2 id="tour-title" class="m-0 mt-1 text-heading font-semibold">{t(`tour.${step.id}.title`)}</h2>
  <p class="m-0 mt-2 text-text-secondary">{t(`tour.${step.id}.body`)}</p>
  {#if step.id === "shortcuts"}
    <ul class="m-0 mt-2 list-none space-y-1 p-0">
      {#each SHORTCUTS as shortcut (shortcut.keys)}
        <li class="flex items-center gap-2">
          <kbd class="rounded-sm border border-border bg-surface px-1.5 py-px font-mono text-caption">{shortcut.keys}</kbd>
          <span class="text-text-secondary">{t(`tour.shortcut.${shortcut.label}`)}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="mt-3 flex items-center gap-2">
    <Button size="sm" variant="ghost" onclick={finish}>{t("tour.skip")}</Button>
    <span class="flex-1"></span>
    {#if index > 0}
      <Button size="sm" variant="outline" onclick={() => (index -= 1)}>{t("tour.previous")}</Button>
    {/if}
    {#if last}
      <Button size="sm" variant="primary" onclick={finish}>{t("tour.done")}</Button>
    {:else}
      <Button size="sm" variant="primary" onclick={() => (index += 1)}>{t("tour.next")}</Button>
    {/if}
  </div>
</div>
