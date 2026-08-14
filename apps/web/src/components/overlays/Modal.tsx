import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useTranslation } from "@/i18n/useTranslation";

/** Anything that can hold focus, minus the things that only look like it can. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * The app's one dialog shell.
 *
 * Three things it now does that a `role="dialog"` div does not get for free,
 * and that every caller was silently missing:
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
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** False while an operation is in flight — Escape and backdrop clicks stop closing the dialog out from under it. */
  dismissable?: boolean;
}) {
  const { t } = useTranslation();
  const { onClose, dismissable = true } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedBackdropRef = useRef(false);

  useEscapeKey(dismissable, onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (dialog) {
      const first = focusableWithin(dialog)[0];
      // `autoFocus` on a field inside wins, because it runs first and this only
      // moves focus when nothing else has claimed it.
      if (!dialog.contains(document.activeElement)) (first ?? dialog).focus();
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      // The opener may itself have been removed by the dialog's own action (a
      // row deleted by the delete dialog, say), so check before restoring.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Queried at keydown time: the dialog's contents change as the user works
    // (buttons enable, rows appear), and a list captured on mount goes stale.
    const focusable = focusableWithin(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    pressedBackdropRef.current = event.target === event.currentTarget;
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const startedOnBackdrop = pressedBackdropRef.current;
    pressedBackdropRef.current = false;
    if (!dismissable || !startedOnBackdrop || event.target !== event.currentTarget) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex animate-overlay-in items-center justify-center bg-overlay p-4 backdrop-blur-[3px]"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`flex max-h-[86vh] w-[640px] max-w-full animate-modal-in flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl outline-hidden ${props.wide ? "sm:w-[760px]" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onKeyDown={handleKeyDown}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span className="truncate text-[14px] font-bold tracking-[-0.01em]">{props.title}</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} data-tooltip={t("common.close")}>
            <CloseIcon size={15} />
          </Button>
        </div>
        <div className="overflow-y-auto p-4">{props.children}</div>
      </div>
    </div>
  );
}
