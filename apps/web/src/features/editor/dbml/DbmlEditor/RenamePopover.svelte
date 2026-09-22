<script lang="ts">
  import { autofocus } from "@/actions/autofocus";
  import type { RenameRequest } from "@/features/editor/dbml/rename";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let {
    rename,
    value,
    onChange,
    onCommit,
    onCancel,
    onDismiss,
  }: {
    rename: RenameRequest;
    value: string;
    onChange: (value: string) => void;
    onCommit: () => void;
    /** Escape: closes the popover and refocuses the editor. */
    onCancel: () => void;
    /** Blur: closes the popover without stealing focus back. */
    onDismiss: () => void;
  } = $props();

  const { t } = useTranslation();
</script>

<div class="absolute left-1/2 top-6 z-40 w-[86%] -translate-x-1/2 rounded-lg border border-border bg-surface p-2 shadow-2xl">
  <div class="mb-1 px-1 text-[11px] text-text-muted">
    {t("dbml.renameSummary", { kind: rename.kind, owner: rename.owner ?? "", count: rename.occurrences })}
  </div>
  <input
    use:autofocus
    {value}
    oninput={(event) => onChange(event.currentTarget.value)}
    onkeydown={(event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }}
    onblur={onDismiss}
    class="w-full rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-hidden focus:border-primary"
  />
</div>
