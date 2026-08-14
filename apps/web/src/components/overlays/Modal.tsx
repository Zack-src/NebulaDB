import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useTranslation } from "@/i18n/useTranslation";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const { onClose } = props;

  useEscapeKey(true, onClose);

  return (
    <div
      className="fixed inset-0 z-[1000] flex animate-overlay-in items-center justify-center bg-overlay p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[86vh] w-[640px] max-w-full animate-modal-in flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl ${props.wide ? "sm:w-[760px]" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
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
