<script lang="ts">
  import type { TableLock } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { LockIcon } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The padlock of a locked table where the lock can only be read — the MCD
   * view, which edits nothing. Same wording as the table node's own padlock:
   * level, who, why.
   */
  let { lock }: { lock: TableLock } = $props();

  const { t } = useTranslation();
  const note = $derived(
    [
      t(lock.level === "full" ? "locks.levelFull" : "locks.levelStructure"),
      lock.lockedByName ? t("locks.by", { name: lock.lockedByName }) : null,
      lock.reason,
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<span
  class="flex h-6 w-6 shrink-0 items-center justify-center"
  role="img"
  aria-label={t("locks.lockedTooltip")}
  data-tooltip={t("locks.lockedTooltip")}
  data-tooltip-note={note}
>
  <Icon icon={LockIcon} size={13} />
</span>
