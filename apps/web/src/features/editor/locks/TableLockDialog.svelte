<script lang="ts">
  import { untrack } from "svelte";
  import {
    TABLE_LOCK_REASON_MAX,
    type TableLock,
    type TableLockAuthority,
    type TableLockLevel,
  } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import RadioGroup from "@/components/ui/RadioGroup.svelte";
  import TextArea from "@/components/ui/TextArea.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { lockTable, unlockTable } from "@/services/tableLocksApi";

  /**
   * Places, changes or lifts the lock on one table. Only ever opened for
   * someone who may manage this particular lock — everyone else gets the
   * padlock's tooltip, which says who locked the table and why.
   */
  let {
    projectId,
    tableId,
    tableName,
    lock,
    canManage,
    onChanged,
    onClose,
  }: {
    projectId: string;
    tableId: string;
    tableName: string;
    /** The lock currently on the table, if any. */
    lock: TableLock | null;
    canManage: TableLockAuthority;
    /** Called after a successful change, before the dialog closes. */
    onChanged: () => void;
    onClose: () => void;
  } = $props();

  const i18n = useTranslation();
  const { t } = i18n;
  // Initial values only: the dialog edits a draft, it does not follow the lock.
  const initial = untrack(() => lock);
  let level = $state<TableLockLevel>(initial?.level ?? "structure");
  let authority = $state<TableLockAuthority>(initial?.authority ?? "project");
  let reason = $state(initial?.reason ?? "");

  const save = useAsyncAction(async () => {
    await lockTable(projectId, tableId, { level, authority, reason: reason.trim() || null });
    toast.success(t("locks.lockedToast", { table: tableName }));
    onChanged();
    onClose();
  });
  const lift = useAsyncAction(async () => {
    await unlockTable(projectId, tableId);
    toast.success(t("locks.unlockedToast", { table: tableName }));
    onChanged();
    onClose();
  });
  const pending = $derived(save.pending || lift.pending);
</script>

<Modal title={t("locks.dialogTitle", { table: tableName })} {onClose} narrow dismissable={!pending}>
  <form
    class="flex flex-col gap-3.5"
    onsubmit={(event) => {
      event.preventDefault();
      if (!pending) void save.run();
    }}
  >
    <Hint>{t("locks.dialogIntro")}</Hint>
    {#if lock}
      <p class="m-0 text-label text-text-muted">
        {t("locks.lockedBy", {
          name: lock.lockedByName ?? t("common.unknown"),
          date: formatDateTime(lock.lockedAt, i18n.locale),
        })}
      </p>
    {/if}

    <div class="flex flex-col gap-1.5">
      <span id="lock-level-label" class={LABEL_CLASS}>{t("locks.level")}</span>
      <RadioGroup
        bind:value={level}
        aria-labelledby="lock-level-label"
        disabled={pending}
        options={[
          { value: "structure", label: t("locks.levelStructure"), hint: t("locks.levelStructureHint") },
          { value: "full", label: t("locks.levelFull"), hint: t("locks.levelFullHint") },
        ]}
      />
    </div>

    {#if canManage === "instance"}
      <div class="flex flex-col gap-1.5">
        <span id="lock-authority-label" class={LABEL_CLASS}>{t("locks.authority")}</span>
        <RadioGroup
          bind:value={authority}
          aria-labelledby="lock-authority-label"
          disabled={pending}
          options={[
            { value: "project", label: t("locks.authorityProject"), hint: t("locks.authorityProjectHint") },
            { value: "instance", label: t("locks.authorityInstance"), hint: t("locks.authorityInstanceHint") },
          ]}
        />
      </div>
    {/if}

    <label class="flex flex-col gap-1.5">
      <span class={LABEL_CLASS}>{t("locks.reason")}</span>
      <TextArea
        bind:value={reason}
        variant="sm"
        autoGrow
        rows={2}
        maxRows={5}
        maxlength={TABLE_LOCK_REASON_MAX}
        placeholder={t("locks.reasonPlaceholder")}
        disabled={pending}
        class="w-full"
      />
    </label>

    {#if save.error || lift.error}<ErrorText>{save.error ?? lift.error}</ErrorText>{/if}

    <div class="flex items-center gap-2 border-t border-border pt-3">
      {#if lock}
        <Button size="sm" variant="danger-ghost" onclick={() => void lift.run()} disabled={pending}>
          {t("locks.unlock")}
        </Button>
      {/if}
      <span class="flex-1"></span>
      <Button size="sm" variant="ghost" onclick={onClose} disabled={pending}>{t("common.cancel")}</Button>
      <Button type="submit" size="sm" variant="primary" disabled={pending}>
        {lock ? t("common.save") : t("locks.lock")}
      </Button>
    </div>
  </form>
</Modal>
