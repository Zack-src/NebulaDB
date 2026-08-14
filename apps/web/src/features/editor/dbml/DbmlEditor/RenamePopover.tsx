import type { RenameRequest } from "@/features/editor/dbml/rename";
import { useTranslation } from "@/i18n/useTranslation";

export function RenamePopover(props: {
  rename: RenameRequest;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  /** Escape: closes the popover and refocuses the editor. */
  onCancel: () => void;
  /** Blur: closes the popover without stealing focus back. */
  onDismiss: () => void;
}) {
  const { rename, value, onChange, onCommit, onCancel, onDismiss } = props;
  const { t } = useTranslation();

  return (
    <div className="absolute left-1/2 top-6 z-40 w-[86%] -translate-x-1/2 rounded-lg border border-border bg-surface p-2 shadow-2xl">
      <div className="mb-1 px-1 text-[11px] text-text-muted">
        {t("dbml.renameSummary", {
          kind: rename.kind,
          owner: rename.owner ?? "",
          count: rename.occurrences,
        })}
      </div>
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={onDismiss}
        className="w-full rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-hidden focus:border-primary"
      />
    </div>
  );
}
