<script lang="ts">
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { ApiError } from "@/services/ApiError";
  import { saveQuery } from "@/services/dbAdminApi";

  /**
   * Keeps the statement under a name. Saving never runs it. A name already
   * used by one of the person's own queries asks before replacing it.
   */
  let {
    connectionId,
    sql,
    ownNames,
    onSaved,
    onClose,
  }: {
    connectionId: string;
    sql: string;
    /** Names of the caller's own queries, to ask before overwriting without a round trip. */
    ownNames: string[];
    onSaved: () => void;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  let name = $state("");
  let description = $state("");
  let overwriting = $state(false);

  const save = useAsyncAction(async (overwrite: boolean) => {
    try {
      await saveQuery(connectionId, { name: name.trim(), sql, description: description.trim() || null, overwrite });
    } catch (err) {
      if (err instanceof ApiError && err.code === "SAVED_QUERY_NAME_TAKEN") {
        overwriting = true;
        return;
      }
      throw err;
    }
    onSaved();
    onClose();
  });

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (ownNames.includes(trimmed)) overwriting = true;
    else void save.run(false);
  }
</script>

{#if overwriting}
  <ConfirmDialog
    title={t("dbadmin.sql.saved.overwriteTitle")}
    message={t("dbadmin.sql.saved.overwriteMessage", { name: name.trim() })}
    danger="warning"
    confirmLabel={t("dbadmin.sql.saved.overwrite")}
    pending={save.pending}
    error={save.error}
    onCancel={() => (overwriting = false)}
    onConfirm={() => void save.run(true)}
  />
{:else}
  <ConfirmDialog
    title={t("dbadmin.sql.saved.saveTitle")}
    confirmLabel={t("common.save")}
    pending={save.pending}
    error={save.error}
    onCancel={onClose}
    onConfirm={submit}
  >
      <label class="flex flex-col gap-1.5">
        <span class={LABEL_CLASS}>{t("dbadmin.sql.saved.name")}</span>
        <Input
          bind:value={name}
          autofocus
          maxlength={120}
          autocomplete="off"
          disabled={save.pending}
          wrapperClassName="w-full"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class={LABEL_CLASS}>{t("dbadmin.sql.saved.description")}</span>
        <Input
          bind:value={description}
          maxlength={500}
          autocomplete="off"
          disabled={save.pending}
          wrapperClassName="w-full"
        />
      </label>
  </ConfirmDialog>
{/if}
