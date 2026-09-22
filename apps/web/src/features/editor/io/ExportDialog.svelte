<script lang="ts" module>
  /** JPEG has no alpha channel, so the background must be painted in explicitly before drawing the (possibly-transparent) source image on top. */
  function pngDataUrlToJpeg(pngDataUrl: string, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("2D canvas context unavailable"));
          return;
        }
        ctx.fillStyle = "#17181b";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = () => reject(new Error("Failed to prepare the canvas snapshot for PDF export"));
      img.src = pngDataUrl;
    });
  }

  const PDF_EXPORTER_ID = "pdf";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { Project } from "@athanordb/shared";
  import { DownloadIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useExporters } from "@/features/plugins/plugins.svelte";
  import type { ExportResult } from "@/features/plugins/types";
  import type { CanvasImageCapture } from "@/types/index";
  import { copyText } from "@/utils/clipboard";
  import { triggerDownload } from "@/utils/download";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * Every format in this dialog — text and image/PDF alike — comes from an
   * exporter *contribution*, supplied by the built-in `athanordb.core-export`
   * plugin (a user plugin adding one more shows up here with no change to this
   * file). The image/PDF ones still capture the live Svelte Flow canvas rather
   * than generating anything from project data: `useExporters`'s second
   * argument threads `captureCanvasImage` through to `PluginRunContext`
   * (builtins only — a sandboxed user plugin never gets a function reference
   * across its worker boundary, see `builtins/types.ts`), so those three
   * runners can call it. PDF packaging itself (jsPDF) stays here at download
   * time — it's presentation, not export logic.
   */
  let props: {
    projectId: string;
    projectName: string;
    project: Project | null;
    captureCanvasImage: (format: "png" | "svg") => Promise<CanvasImageCapture>;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const exporters = useExporters(() => props.projectId, {
    captureCanvasImage: (format) => props.captureCanvasImage(format),
  });
  let selection = $state("athanordb.core-export:dbml");
  let result = $state.raw<ExportResult | null>(null);
  let busy = $state(false);
  let copied = $state(false);
  let error = $state<string | null>(null);

  const exporter = $derived(exporters.list.find((e) => e.key === selection) ?? null);
  // Known synchronously from the contribution itself, not from `result` — so
  // the dialog switches to the image-preview layout the instant an image
  // exporter is picked, rather than waiting on its (async) capture to resolve.
  const isImage = $derived(Boolean(exporter?.contribution.imageKind));

  // Falling back keeps the dialog usable if the selected exporter's plugin is
  // disabled or uninstalled while the dialog is open.
  $effect(() => {
    if (!exporter && exporters.list.length > 0) selection = exporters.list[0].key;
  });

  // A value-stable projection of the exporter list. The effect below has to
  // re-run when an exporter genuinely appears or disappears — user plugins boot
  // asynchronously, so the one the dialog opened on may not exist yet — but
  // *not* when the registry hands out a new array holding the same exporters.
  // Depending on the array itself made a failing exporter self-perpetuating:
  // run → registry snapshot churns → new identity → run again.
  const exporterKeys = $derived(exporters.list.map((e) => e.key).join("|"));

  $effect(() => {
    void exporterKeys;
    const key = selection;
    const project = props.project;
    const projectId = props.projectId;
    const projectName = props.projectName;
    const target = untrack(() => exporters.list.find((e) => e.key === key));
    if (!target) return;
    let cancelled = false;
    busy = true;
    error = null;
    target
      .run(
        project ??
          ({
            id: projectId,
            name: projectName,
            tables: [],
            refs: [],
            enums: [],
            zones: [],
            stickyNotes: [],
            tableGroups: [],
          } as unknown as Project),
      )
      .then((value) => {
        if (!cancelled) result = value as ExportResult;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          result = null;
          error = err instanceof Error ? err.message : String(err);
        }
      })
      .finally(() => {
        if (!cancelled) busy = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const text = $derived(result?.text ?? "");
  const image = $derived(result?.image ?? null);

  function copy() {
    void copyText(text).then((ok) => {
      if (!ok) {
        error = t("export.copyFailed");
        return;
      }
      copied = true;
      window.setTimeout(() => (copied = false), 1200);
    });
  }

  async function download() {
    if (isImage) {
      if (!image) return;
      if (exporter?.contribution.id === PDF_EXPORTER_ID) {
        // jsPDF is only needed for this one branch — dynamic import keeps it
        // out of the bundle everyone else loads.
        const { jsPDF } = await import("jspdf");
        // jsPDF's addImage embeds a PNG essentially uncompressed — a two-table
        // diagram came out over 10MB. Re-encoding to JPEG first (this is a
        // decorative snapshot, not something needing lossless fidelity) brings
        // that down by roughly two orders of magnitude.
        const jpeg = await pngDataUrlToJpeg(image.dataUrl, image.width, image.height);
        const orientation = image.width >= image.height ? "landscape" : "portrait";
        const pdf = new jsPDF({ orientation, unit: "px", format: [image.width, image.height] });
        pdf.addImage(jpeg, "JPEG", 0, 0, image.width, image.height);
        pdf.save(`${props.projectName}.pdf`);
        return;
      }
      triggerDownload(image.dataUrl, `${props.projectName}.${image.format}`);
      return;
    }
    const ext = result?.extension ?? exporter?.contribution.extension ?? "txt";
    const blob = new Blob([text], { type: "text/plain" });
    triggerDownload(URL.createObjectURL(blob), `${props.projectName}.${ext}`, true);
  }
</script>

<Modal title={t("export.title")} onClose={props.onClose}>
  <div class="mb-2.5 flex items-center gap-2">
    <select class={SELECT_CLASS} value={selection} onchange={(event) => (selection = event.currentTarget.value)}>
      {#each exporters.list as e (e.key)}
        <option value={e.key}>{e.contribution.label}{e.source === "user" ? ` — ${e.plugin.name}` : ""}</option>
      {/each}
    </select>
    {#if !isImage}
      <Button onclick={copy} disabled={busy || !text}>
        {copied ? "Copied" : "Copy"}
      </Button>
    {/if}
    <Button variant="primary" onclick={download} disabled={busy || (isImage ? !image : !text)}>
      <Icon icon={DownloadIcon} size={13} />
      {t("export.download")}
    </Button>
  </div>
  {#if isImage}
    <div
      class="flex min-h-80 flex-col items-center justify-center rounded-sm border border-border bg-[var(--color-bg-canvas)] p-3"
    >
      {#if busy}<span class="text-text-muted">{t("export.rendering")}</span>{/if}
      {#if !busy && image}
        <img src={image.dataUrl} alt={t("export.previewAlt")} class="max-h-[296px] max-w-full rounded-sm shadow-sm" />
      {/if}
      {#if exporter?.contribution.id === PDF_EXPORTER_ID && !busy && image}<Hint>{t("export.pdfHint")}</Hint>{/if}
    </div>
  {:else}
    <textarea readonly class={`${TEXTAREA_CODE_CLASS} h-80 w-full`} value={busy ? t("common.loading") : text}></textarea>
  {/if}
  {#if exporter?.source === "user"}<Hint>{t("export.generatedByPlugin", { name: exporter.plugin.name })}</Hint>{/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</Modal>
