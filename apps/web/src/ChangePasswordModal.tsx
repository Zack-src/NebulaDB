import { useState } from "react";
import { Modal } from "./Modal.js";
import { Button } from "./ui/Button.js";
import { Field } from "./ui/Field.js";
import { ErrorText, Hint } from "./ui/Alert.js";

/** Self-service password change — requires the current password, unlike the admin reset in AdminConsole. */
function ChangePasswordModal(props: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit faire au moins 8 caractères.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Échec (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Modifier le mot de passe" onClose={props.onClose}>
      {done ? (
        <Hint>Mot de passe modifié.</Hint>
      ) : (
        <>
          <Field
            label="Mot de passe actuel"
            type="password"
            autoFocus
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Field
            label="Nouveau mot de passe"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <Field
            label="Confirmer le nouveau mot de passe"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          <Button variant="primary" onClick={submit} disabled={busy || !currentPassword || !newPassword || !confirm}>
            {busy ? "Modification…" : "Modifier le mot de passe"}
          </Button>
          {error && <ErrorText>{error}</ErrorText>}
        </>
      )}
    </Modal>
  );
}

export { ChangePasswordModal };
export default ChangePasswordModal;
