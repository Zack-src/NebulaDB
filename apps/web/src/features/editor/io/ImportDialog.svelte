<script lang="ts">
  import { UploadIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useImporters } from "@/features/plugins/plugins.svelte";
  import type { ImportResult } from "@/features/plugins/types";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { importSource } from "@/services/projectsApi";

  /**
   * Import is a two-step pipeline now: the selected importer *contribution*
   * turns whatever the user pasted into DBML, and the existing server import
   * route merges that DBML into the project by name. Built-in DBML/SQL and a
   * user plugin's own format take exactly the same path.
   */
  let props: { projectId: string; onClose: () => void } = $props();

  const { t } = useTranslation();
  const importers = useImporters(() => props.projectId);
  let source = $state("");
  let selection = $state("athanordb.core-import:dbml");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let fileName = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  const importer = $derived(importers.list.find((i) => i.key === selection) ?? null);

  $effect(() => {
    if (!importer && importers.list.length > 0) selection = importers.list[0].key;
  });

  /** Extensions any installed importer claims, so the file picker offers them. */
  const accept = $derived(
    Array.from(
      new Set(
        importers.list.flatMap((i) => i.contribution.fileExtensions ?? []).map((ext) => `.${ext.replace(/^\./, "")}`),
      ),
    )
      .concat(".txt")
      .join(","),
  );

  async function handleFile(file: File) {
    source = await file.text();
    fileName = file.name;
    error = null;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext) return;
    // Pick the first importer that claims this extension, preferring one whose
    // id matches it exactly (so a `.dbml` file lands on the DBML importer
    // rather than on whichever SQL dialect happens to come first).
    const claiming = importers.list.filter((i) => (i.contribution.fileExtensions ?? []).includes(ext));
    const exact = claiming.find((i) => i.contribution.id === ext);
    const next = exact ?? claiming[0];
    if (next) selection = next.key;
  }

  async function submit() {
    if (!source.trim() || !importer) return;
    busy = true;
    error = null;
    try {
      const produced = (await importer.run(source)) as ImportResult;
      const dbml = produced?.dbml ?? "";
      if (!dbml.trim()) throw new Error(`${importer.contribution.label} produced no DBML`);

      await importSource(props.projectId, dbml);
      props.onClose();
    } catch (err) {
      error = describeApiError(err, t);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t("import.title")} onClose={props.onClose}>
  <Hint>{t("import.mergeHint")}</Hint>
  <div class="mb-2.5 flex items-center gap-2">
    <select class={SELECT_CLASS} value={selection} onchange={(event) => (selection = event.currentTarget.value)}>
      {#each importers.list as i (i.key)}
        <option value={i.key}>{i.contribution.label}{i.source === "user" ? ` — ${i.plugin.name}` : ""}</option>
      {/each}
    </select>
    <input
      bind:this={fileInput}
      type="file"
      {accept}
      class="hidden"
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void handleFile(file);
        event.currentTarget.value = "";
      }}
    />
    <Button onclick={() => fileInput?.click()}>
      <Icon icon={UploadIcon} size={13} />
      {fileName ?? t("import.chooseFile")}
    </Button>
    <span class="flex-1"></span>
    <Button variant="primary" onclick={submit} disabled={busy || !source.trim() || !importer}>
      {busy ? t("common.loading") : t("editor.import")}
    </Button>
  </div>
  <textarea
    class={`${TEXTAREA_CODE_CLASS} h-80 w-full`}
    value={source}
    oninput={(event) => {
      source = event.currentTarget.value;
      fileName = null;
    }}
    placeholder={importer?.contribution.id === "dbml"
      ? "Paste DBML, or choose a .dbml/.sql file…"
      : `Paste ${importer?.contribution.label ?? "source"} input, or choose a file…`}
  ></textarea>
  {#if importer?.source === "user"}<Hint>{t("import.parsedByPlugin", { name: importer.plugin.name })}</Hint>{/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</Modal>
