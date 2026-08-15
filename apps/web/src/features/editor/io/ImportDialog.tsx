import { useEffect, useRef, useState } from "react";
import { UploadIcon } from "@/components/icons/Icons";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useImporters } from "@/features/plugins/usePlugins";
import type { ImportResult } from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";
import { describeApiError } from "@/i18n/serverErrorMessages";
import { importSource } from "@/services/projectsApi";

/**
 * Import is a two-step pipeline now: the selected importer *contribution*
 * turns whatever the user pasted into DBML, and the existing server import
 * route merges that DBML into the project by name. Built-in DBML/SQL and a
 * user plugin's own format take exactly the same path.
 */
function ImportDialog(props: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const importers = useImporters(props.projectId);
  const [source, setSource] = useState("");
  const [selection, setSelection] = useState("athanordb.core-import:dbml");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importer = importers.find((i) => i.key === selection) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recovering from an importer that disappeared mid-dialog, not derived state
    if (!importer && importers.length > 0) setSelection(importers[0].key);
  }, [importer, importers]);

  /** Extensions any installed importer claims, so the file picker offers them. */
  const accept = Array.from(
    new Set(
      importers.flatMap((i) => i.contribution.fileExtensions ?? []).map((event) => `.${event.replace(/^\./, "")}`),
    ),
  )
    .concat(".txt")
    .join(",");

  const handleFile = async (file: File) => {
    setSource(await file.text());
    setFileName(file.name);
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext) return;
    // Pick the first importer that claims this extension, preferring one whose
    // id matches it exactly (so a `.dbml` file lands on the DBML importer
    // rather than on whichever SQL dialect happens to come first).
    const claiming = importers.filter((i) => (i.contribution.fileExtensions ?? []).includes(ext));
    const exact = claiming.find((i) => i.contribution.id === ext);
    const next = exact ?? claiming[0];
    if (next) setSelection(next.key);
  };

  const submit = async () => {
    if (!source.trim() || !importer) return;
    setBusy(true);
    setError(null);
    try {
      const produced = (await importer.run(source)) as ImportResult;
      const dbml = produced?.dbml ?? "";
      if (!dbml.trim()) throw new Error(`${importer.contribution.label} produced no DBML`);

      await importSource(props.projectId, dbml);
      props.onClose();
    } catch (err) {
      setError(describeApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("import.title")} onClose={props.onClose}>
      <Hint>{t("import.mergeHint")}</Hint>
      <div className="mb-2.5 flex items-center gap-2">
        <select className={SELECT_CLASS} value={selection} onChange={(event) => setSelection(event.target.value)}>
          {importers.map((i) => (
            <option key={i.key} value={i.key}>
              {i.contribution.label}
              {i.source === "user" ? ` — ${i.plugin.name}` : ""}
            </option>
          ))}
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = "";
          }}
        />
        <Button onClick={() => fileInputRef.current?.click()}>
          <UploadIcon size={13} /> {fileName ?? t("import.chooseFile")}
        </Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={submit} disabled={busy || !source.trim() || !importer}>
          {busy ? t("common.loading") : t("editor.import")}
        </Button>
      </div>
      <textarea
        className={`${TEXTAREA_CODE_CLASS} h-80 w-full`}
        value={source}
        onChange={(event) => {
          setSource(event.target.value);
          setFileName(null);
        }}
        placeholder={
          importer?.contribution.id === "dbml"
            ? "Paste DBML, or choose a .dbml/.sql file…"
            : `Paste ${importer?.contribution.label ?? "source"} input, or choose a file…`
        }
      />
      {importer?.source === "user" && <Hint>{t("import.parsedByPlugin", { name: importer.plugin.name })}</Hint>}
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}

export { ImportDialog };
export default ImportDialog;
