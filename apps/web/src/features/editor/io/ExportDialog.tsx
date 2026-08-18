import { useEffect, useMemo, useState } from "react";
import type { Project } from "@athanordb/shared";
import { DownloadIcon } from "@/components/icons/Icons";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useExporters } from "@/features/plugins/usePlugins";
import type { ExportResult } from "@/features/plugins/types";
import type { CanvasImageCapture } from "@/types/index";
import { copyText } from "@/utils/clipboard";
import { triggerDownload } from "@/utils/download";
import { useTranslation } from "@/i18n/useTranslation";

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

/**
 * Every format in this dialog — text and image/PDF alike — comes from an
 * exporter *contribution*, supplied by the built-in `athanordb.core-export`
 * plugin (a user plugin adding one more shows up here with no change to this
 * file). The image/PDF ones still capture the live React Flow canvas rather
 * than generating anything from project data: `useExporters`'s second
 * argument threads `captureCanvasImage` through to `PluginRunContext`
 * (builtins only — a sandboxed user plugin never gets a function reference
 * across its worker boundary, see `builtins/types.ts`), so those three
 * runners can call it. PDF packaging itself (jsPDF) stays here at download
 * time — it's presentation, not export logic.
 */
function ExportDialog(props: {
  projectId: string;
  projectName: string;
  project: Project | null;
  captureCanvasImage: (format: "png" | "svg") => Promise<CanvasImageCapture>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const exporters = useExporters(props.projectId, { captureCanvasImage: props.captureCanvasImage });
  const [selection, setSelection] = useState<string>(() => `athanordb.core-export:dbml`);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exporter = useMemo(() => exporters.find((e) => e.key === selection) ?? null, [exporters, selection]);
  // Known synchronously from the contribution itself, not from `result` — so
  // the dialog switches to the image-preview layout the instant an image
  // exporter is picked, rather than waiting on its (async) capture to resolve.
  const isImage = Boolean(exporter?.contribution.imageKind);

  // Falling back keeps the dialog usable if the selected exporter's plugin is
  // disabled or uninstalled while the dialog is open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recovering from an exporter that disappeared mid-dialog, not derived state
    if (!exporter && exporters.length > 0) setSelection(exporters[0].key);
  }, [exporter, exporters]);

  // A value-stable projection of the exporter list. The effect below has to
  // re-run when an exporter genuinely appears or disappears — user plugins boot
  // asynchronously, so the one the dialog opened on may not exist yet — but
  // *not* when the registry hands out a new array holding the same exporters.
  // Depending on the array itself made a failing exporter self-perpetuating:
  // run → registry snapshot churns → new identity → run again.
  const exporterKeys = useMemo(() => exporters.map((e) => e.key).join("|"), [exporters]);

  useEffect(() => {
    const target = exporters.find((e) => e.key === selection);
    if (!target) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the export this same effect kicks off
    setBusy(true);
    setError(null);
    target
      .run(
        props.project ??
          ({
            id: props.projectId,
            name: props.projectName,
            tables: [],
            refs: [],
            enums: [],
            zones: [],
            stickyNotes: [],
            tableGroups: [],
          } as Project),
      )
      .then((value) => {
        if (!cancelled) setResult(value as ExportResult);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // `exporters` is read but intentionally not a dependency — `exporterKeys`
    // is its stable projection (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exporterKeys, selection, props.project, props.projectId, props.projectName]);

  const text = result?.text ?? "";
  const image = result?.image ?? null;

  const copy = () => {
    void copyText(text).then((ok) => {
      if (!ok) {
        setError(t("export.copyFailed"));
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const download = async () => {
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
  };

  return (
    <Modal title={t("export.title")} onClose={props.onClose}>
      <div className="mb-2.5 flex items-center gap-2">
        <select className={SELECT_CLASS} value={selection} onChange={(event) => setSelection(event.target.value)}>
          {exporters.map((e) => (
            <option key={e.key} value={e.key}>
              {e.contribution.label}
              {e.source === "user" ? ` — ${e.plugin.name}` : ""}
            </option>
          ))}
        </select>
        {!isImage && (
          <Button onClick={copy} disabled={busy || !text}>
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
        <Button variant="primary" onClick={download} disabled={busy || (isImage ? !image : !text)}>
          <DownloadIcon size={13} /> {t("export.download")}
        </Button>
      </div>
      {isImage ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-sm border border-border bg-[var(--color-bg-canvas)] p-3">
          {busy && <span className="text-text-muted">{t("export.rendering")}</span>}
          {!busy && image && (
            <img
              src={image.dataUrl}
              alt={t("export.previewAlt")}
              className="max-h-[296px] max-w-full rounded-sm shadow-sm"
            />
          )}
          {exporter?.contribution.id === PDF_EXPORTER_ID && !busy && image && <Hint>{t("export.pdfHint")}</Hint>}
        </div>
      ) : (
        <textarea readOnly className={`${TEXTAREA_CODE_CLASS} h-80 w-full`} value={busy ? t("common.loading") : text} />
      )}
      {exporter?.source === "user" && <Hint>{t("export.generatedByPlugin", { name: exporter.plugin.name })}</Hint>}
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}

export { ExportDialog };
export default ExportDialog;
