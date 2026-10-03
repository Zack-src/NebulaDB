<script lang="ts" module>
  import {
    AlertTriangleIcon,
    CheckCircleIcon,
    InfoIcon,
  } from "@/components/icons/Icons";
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import type { ToastTone } from "@/components/ui/toast.svelte";

  const TONE_ICON: Record<ToastTone, IconDefinition> = {
    info: InfoIcon,
    success: CheckCircleIcon,
    warning: AlertTriangleIcon,
    danger: AlertTriangleIcon,
  };

  const TONE_CLASS: Record<ToastTone, string> = {
    info: "text-info",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  };
</script>

<script lang="ts">
  import { fly } from "svelte/transition";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon } from "@/components/icons/Icons";
  import { toast } from "@/components/ui/toast.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Renders the `toast` stack. Mounted once, at the app root. Top right, just
   * under the 56px app header: the bottom of the editor belongs to the canvas
   * toolbar and the minimap.
   *
   * The region is a polite live region, so a new message is read out without
   * interrupting; a `danger` toast is an `alert`, which does interrupt. Hovering
   * or focusing the stack freezes every countdown — a message with an "Annuler"
   * button must not vanish while the pointer is on its way to it.
   */
  const { t } = useTranslation();

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
</script>

<div
  class="pointer-events-none fixed right-4 top-[68px] z-[var(--z-toast)] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
  role="region"
  aria-label={t("ui.toast.region")}
  aria-live="polite"
  onmouseenter={toast.pause}
  onmouseleave={toast.resume}
  onfocusin={toast.pause}
  onfocusout={toast.resume}
>
  {#each toast.entries as entry (entry.id)}
    <div
      role={entry.tone === "danger" ? "alert" : "status"}
      class="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border-strong bg-surface-raised px-3 py-2.5 text-body-sm text-text shadow-lg"
      transition:fly={{ y: -8, duration: reducedMotion ? 0 : 160 }}
    >
      <Icon icon={TONE_ICON[entry.tone]} size={15} class={`mt-px shrink-0 ${TONE_CLASS[entry.tone]}`} />
      <span class="min-w-0 flex-1 break-words leading-snug">{entry.message}</span>
      {#if entry.action}
        {@const action = entry.action}
        <button
          type="button"
          class="shrink-0 rounded-sm px-1.5 font-semibold text-primary hover:bg-primary-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onclick={() => {
            action.run();
            toast.dismiss(entry.id);
          }}
        >
          {action.label}
        </button>
      {/if}
      <button
        type="button"
        class="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={t("common.close")}
        onclick={() => toast.dismiss(entry.id)}
      >
        <Icon icon={CloseIcon} size={12} />
      </button>
    </div>
  {/each}
</div>
