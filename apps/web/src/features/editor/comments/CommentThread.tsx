import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_TEXT_LENGTH, type Comment } from "@athanordb/shared";
import { CloseIcon, CommentIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { TEXTAREA_SM_CLASS } from "@/components/ui/inputStyles";
import { useAnchoredPlacement } from "@/hooks/useMenuPlacement";
import { useDismissablePopover } from "@/hooks/useDismissablePopover";
import { useTranslation } from "@/i18n/useTranslation";

/** "2026-07-29T09:31:59.868Z" -> "2026-07-29 09:31:59" — matches the plain UTC-timestamp style the revision history list already uses. */
function formatTimestamp(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

/**
 * Small comment-thread trigger + popover, used both on a table's header
 * (table-level comments) and on individual field rows (field-level) —
 * same portal-to-`document.body` approach as `ColorSwatchPicker` for the
 * same reason: both live inside a React Flow node, which clips overflow and
 * gets CSS-transformed for pan/zoom.
 */
export function CommentThread(props: {
  comments: Comment[];
  currentUser: string;
  onAdd: (text: string) => void;
  onDelete: (commentId: string) => void;
  triggerClassName: string;
  tooltip?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useDismissablePopover(open, () => setOpen(false), [popoverRef, triggerRef]);

  const placement = useAnchoredPlacement(open ? triggerRect : null, popoverRef);

  const toggle = () => {
    if (!open && triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    props.onAdd(text);
    setDraft("");
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`nodrag ${props.triggerClassName}${props.comments.length > 0 ? " has-comments" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        data-tooltip={props.tooltip ?? t("comments.title")}
      >
        <CommentIcon size={12} />
        {props.comments.length > 0 && (
          <span className="text-[10px] font-bold leading-none">{props.comments.length}</span>
        )}
      </button>
      {open &&
        triggerRect &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[var(--z-popover)] flex w-[260px] animate-modal-in flex-col rounded-md border border-border-strong bg-surface-raised shadow-lg nodrag"
            style={placement ?? { left: triggerRect.left, top: triggerRect.bottom + 6, visibility: "hidden" }}
          >
            <div className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto p-2">
              {props.comments.length === 0 && (
                <div className="px-0.5 py-1.5 text-xs text-text-muted">{t("comments.empty")}</div>
              )}
              {props.comments.map((c) => (
                <div key={c.id} className="rounded-sm bg-surface p-1.5">
                  <div className="mb-0.5 flex items-baseline gap-1.5">
                    <span className="text-[11.5px] font-bold text-text">{c.author}</span>
                    <span className="flex-1 text-[10.5px] text-text-muted">{formatTimestamp(c.createdAt)}</span>
                    {c.author === props.currentUser && (
                      <button
                        className="shrink-0 p-0 text-text-muted hover:text-danger"
                        onClick={() => props.onDelete(c.id)}
                        data-tooltip={t("comments.delete")}
                      >
                        <CloseIcon size={11} />
                      </button>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.4] text-text-secondary">
                    {c.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 border-t border-border p-2">
              <textarea
                className={`${TEXTAREA_SM_CLASS} flex-1`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("comments.placeholder")}
                maxLength={MAX_TEXT_LENGTH}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
                }}
              />
              <Button variant="primary" size="sm" onClick={submit} disabled={!draft.trim()}>
                {t("comments.post")}
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
