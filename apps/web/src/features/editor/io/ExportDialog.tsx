import { useEffect, useMemo, useState } from "react";
import type { Project } from "@athanordb/shared";
import { DownloadIcon } from "@/components/icons/Icons";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useExporters } from "@/features/plugins/usePlugins";
import type { ExportResult } from "@/features/plugins/types";
import type { CanvasImageCapture, ImageFormat } from "@/types/index";
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

const IMAGE_OPTIONS: { value: ImageFormat; label: string }[] = [
  { value: "png", label: "Image — PNG" },
  { value: "svg", label: "Image — SVG" },
  { value: "pdf", label: "PDF" },
];

/**
 * Every text format in this dialog comes from an exporter *contribution* —
 * DBML and the three SQL dialects included, which are now supplied by the
 * built-in `athandordb.core-export` plugin. A user plugin adding SQLite (or
 * anything else) shows up here with no change to this file.
 *
 * Image/PDF export stays native: it snapshots the live React Flow canvas,
 * which is not something the plugin API exposes.
 */
function ExportDialog(props: {
  projectId: string;
  projectName: string;
  project: Project | null;
  captureCanvasImage: (format: "png" | "svg") => Promise<CanvasImageCapture>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const exporters = useExporters(props.projectId);
  const [selection, setSelection] = useState<string>(() => `plugin:athanordb.core-export:dbml`);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [image, setImage] = useState<CanvasImageCapture | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageFormat = selection.startsWith("image:") ? (selection.slice("image:".length) as ImageFormat) : null;
  const exporter = useMemo(
    () => exporters.find((event) => `plugin:${event.key}` === selection) ?? null,
    [exporters, selection],
  );

  // Falling back keeps the dialog usable if the selected exporter's plugin is
  // disabled or uninstalled while the dialog is open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recovering from an exporter that disappeared mid-dialog, not derived state
    if (!imageFormat && !exporter && exporters.length > 0) setSelection(`plugin:${exporters[0].key}`);
  }, [imageFormat, exporter, exporters]);

  useEffect(() => {
    // Looked up here rather than taken from the memo above so this effect
    // depends on the *list*, which only changes when a plugin is installed,
    // toggled or removed — not on a per-render object identity.
    const target = exporters.find((event) => `plugin:${event.key}` === selection);
    if (!target) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the export this same effect kicks off
    setBusy(true);
    setError(null);
    target
      .run(props.project ?? ({ id: props.projectId, name: props.projectName, tables: [], refs: [], enums: [], zones: [], stickyNotes: [], tableGroups: [] } as Project))
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
  }, [exporters, selection, props.project, props.projectId, props.projectName]);

  useEffect(() => {
    if (!imageFormat) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the capture this same effect kicks off
    setBusy(true);
    setError(null);
    props
      .captureCanvasImage(imageFormat === "svg" ? "svg" : "png")
      .then((value) => {
        if (!cancelled) setImage(value);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // props.captureCanvasImage is a useCallback with an empty dep array in the
    // parent, so it's stable — omitting it avoids re-capturing on unrelated
    // parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFormat]);

  const text = result?.text ?? "";

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const download = async () => {
    if (imageFormat === "png" || imageFormat === "svg") {
      if (image) downloadDataUrl(image.dataUrl, `${props.projectName}.${imageFormat}`);
      return;
    }
    if (imageFormat === "pdf") {
      if (!image) return;
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
    const ext = result?.extension ?? exporter?.contribution.extension ?? "txt";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `${props.projectName}.${ext}`);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title={t("export.title")} onClose={props.onClose}>
      <div className="mb-2.5 flex items-center gap-2">
        <select className={SELECT_CLASS} value={selection} onChange={(event) => setSelection(event.target.value)}>
          {exporters.map((e) => (
            <option key={e.key} value={`plugin:${e.key}`}>
              {e.contribution.label}
              {e.source === "user" ? ` — ${e.plugin.name}` : ""}
            </option>
          ))}
          {IMAGE_OPTIONS.map((o) => (
            <option key={o.value} value={`image:${o.value}`}>
              {o.label}
            </option>
          ))}
        </select>
        {!imageFormat && (
          <Button onClick={copy} disabled={busy || !text}>
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
        <Button variant="primary" onClick={download} disabled={busy || (imageFormat ? !image : !text)}>
          <DownloadIcon size={13} /> {t("export.download")}
        </Button>
      </div>
      {imageFormat ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-sm border border-border bg-[var(--color-bg-canvas)] p-3">
          {busy && <span className="text-text-muted">{t("export.rendering")}</span>}
          {!busy && image && <img src={image.dataUrl} alt={t("export.previewAlt")} className="max-h-[296px] max-w-full rounded-sm shadow-sm" />}
          {imageFormat === "pdf" && !busy && image && <Hint>{t("export.pdfHint")}</Hint>}
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
