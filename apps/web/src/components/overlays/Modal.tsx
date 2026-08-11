import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { useTranslation } from "@/i18n/useTranslation";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const { onClose } = props;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex animate-overlay-in items-center justify-center bg-[rgba(20,23,30,0.45)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[86vh] w-[640px] max-w-[92vw] animate-modal-in flex-col overflow-hidden rounded-lg bg-surface shadow-lg ${props.wide ? "w-[760px]" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-[18px] py-3.5">
          <span className="text-[15px] font-bold tracking-[-0.01em]">{props.title}</span>
          <Button variant="ghost" size="icon" onClick={onClose} data-tooltip={t("common.close")}>
            <CloseIcon size={16} />
          </Button>
        </div>
        <div className="overflow-y-auto p-[18px]">{props.children}</div>
      </div>
    </div>
  );
}
