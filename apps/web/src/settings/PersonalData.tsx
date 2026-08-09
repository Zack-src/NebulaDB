import { useState } from "react";
import { Modal } from "../Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorText, Hint } from "../ui/Alert.js";
import { INPUT_CLASS } from "../ui/inputStyles.js";
import { DownloadIcon, TrashIcon } from "../Icons.js";

/**
 * The two rights a user has over their own data: get a copy of it, and have
 * the account removed. Both were missing entirely — deletion could only be
 * done by an administrator, and there was no export at all.
 */
export function PersonalData() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A hard navigation rather than unwinding React state: once the account is
  // gone, every piece of in-memory state — session, projects, open document —
  // refers to something that no longer exists. Reloading is both simpler and
  // more honest than trying to tear it down gracefully.
  const afterDeletion = () => window.location.assign("/");

  return (
    <div className="pt-6 border-t border-border/60">
      <h3 className="text-sm font-bold text-text mb-1">Vos données</h3>
      <p className="text-xs text-text-muted mb-4">
        Récupérez une copie de ce que cette instance conserve à votre sujet, ou supprimez définitivement votre compte.
      </p>

      <div className="flex flex-wrap gap-2">
        <a
          href="/api/users/me/export"
          download
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong/90 bg-surface-raised/50 px-3.5 py-1.5 text-[13px] font-semibold text-text transition-colors hover:border-primary/80 hover:bg-surface-hover"
        >
          <DownloadIcon size={14} /> Exporter mes données (JSON)
        </a>
        <Button variant="danger" className="gap-1.5 text-xs" onClick={() => setConfirmOpen(true)}>
          <TrashIcon size={13} /> Supprimer mon compte
        </Button>
      </div>

      {confirmOpen && <DeleteAccountModal onClose={() => setConfirmOpen(false)} onDeleted={afterDeletion} />}
    </div>
  );
}

function DeleteAccountModal(props: { onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Échec (${res.status})`);
      }
      props.onDeleted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Supprimer mon compte" onClose={props.onClose}>
      <Hint>
        Action définitive. Votre compte, vos sessions et vos appartenances aux équipes sont supprimés. Les projets dont
        vous êtes propriétaire ne sont pas détruits — ils sont conservés sans propriétaire et restent gérables par un
        administrateur, car ils peuvent être partagés avec toute une équipe. Vos modifications de schéma gardent votre
        nom dans l'historique des projets.
      </Hint>
      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        Confirmez avec votre mot de passe
        <input
          className={`${INPUT_CLASS} mt-1 w-full`}
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <Button variant="danger" className="mt-4" onClick={submit} disabled={busy || !password}>
        {busy ? "Suppression…" : "Supprimer définitivement mon compte"}
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}
