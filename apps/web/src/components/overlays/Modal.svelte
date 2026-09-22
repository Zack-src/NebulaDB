<script lang="ts" module>
  /** Anything that can hold focus, minus the things that only look like it can. */
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusableWithin(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true",
    );
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { useEscapeKey } from "@/hooks/escapeKey.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The app's one dialog shell.
   *
   * Three things it does that a `role="dialog"` div does not get for free:
   *
   *  - focus moves into the dialog on open and back to whatever opened it on
   *    close, so a keyboard user is not dumped at the top of the page;
   *  - Tab is trapped inside, so tabbing does not walk off into the page behind
   *    the scrim;
   *  - the page behind stops scrolling, so a wheel over the backdrop no longer
   *    scrolls the list the dialog is about.
   *
   * Backdrop dismissal requires the press *and* the release to land on the
   * backdrop. Checking only the click target closed the dialog whenever a text
   * selection started inside and ended outside it.
   */
  let {
    title,
    onClose,
    children,
    wide = false,
    dismissable = true,
  }: {
    title: string;
    onClose: () => void;
    children: Snippet;
    wide?: boolean;
    /** False while an operation is in flight — Escape and backdrop clicks stop closing the dialog out from under it. */
    dismissable?: boolean;
  } = $props();

  const { t } = useTranslation();
  let dialog: HTMLDivElement;
  let pressedBackdrop = false;

  useEscapeKey(
    () => dismissable,
    () => onClose(),
  );

  $effect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = focusableWithin(dialog)[0];
    // A field inside that focuses itself on mount (`use:autofocus`) runs after
    // this, so it wins — this only provides the default.
    if (!dialog.contains(document.activeElement)) (first ?? dialog).focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      // The opener may itself have been removed by the dialog's own action (a
      // row deleted by the delete dialog, say), so check before restoring.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    // Queried at keydown time: the dialog's contents change as the user works
    // (buttons enable, rows appear), and a list captured on mount goes stale.
    const focusable = focusableWithin(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const firstElement = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === firstElement || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function handleBackdropMouseDown(event: MouseEvent) {
    pressedBackdrop = event.target === event.currentTarget;
  }

  function handleBackdropClick(event: MouseEvent) {
    const startedOnBackdrop = pressedBackdrop;
    pressedBackdrop = false;
    if (!dismissable || !startedOnBackdrop || event.target !== event.currentTarget) return;
    onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[var(--z-modal)] flex animate-overlay-in items-center justify-center bg-overlay p-4 backdrop-blur-[3px]"
  onmousedown={handleBackdropMouseDown}
  onclick={handleBackdropClick}
>
  <div
    bind:this={dialog}
    tabindex="-1"
    class={`flex max-h-[86vh] w-[640px] max-w-full animate-modal-in flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl outline-hidden ${wide ? "sm:w-[760px]" : ""}`}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onkeydown={handleKeyDown}
  >
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
      <span class="truncate text-[14px] font-bold tracking-[-0.01em]">{title}</span>
      <Button variant="ghost" size="icon-sm" onclick={() => onClose()} data-tooltip={t("common.close")}>
        <Icon icon={CloseIcon} size={15} />
      </Button>
    </div>
    <div class="overflow-y-auto p-4">{@render children()}</div>
  </div>
</div>
