import { useState } from "react";
import { Modal } from "../Modal.js";
import { Button } from "../ui/Button.js";
import { ErrorText, Hint } from "../ui/Alert.js";
import { INPUT_CLASS, SELECT_CLASS } from "../ui/inputStyles.js";
import type { UserSummary } from "../types.js";

/**
 * Deleting an account is the one irreversible action in the admin console, and
 * it has a consequence that isn't obvious from the button: projects the person
 * owns have to go somewhere. The server's default is to leave them ownerless —
 * readable by everyone, manageable only by global admins — and there is no
 * route to re-assign an owner afterwards, so this dialog puts the transfer
 * choice in front of the decision rather than after it.
 *
 * Typing the email to confirm is deliberate friction: the list rows are
 * one click apart and the two neighbouring actions (reset password, disable)
 * are both recoverable.
 */
export function DeleteUserModal(props: {
  targetUser: UserSummary;
  users: UserSummary[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = props.users.filter((u) => u.id !== props.targetUser.id && !u.disabledAt);
  const confirmed = confirmation.trim().toLowerCase() === props.targetUser.email.toLowerCase();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${props.targetUser.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transferTo ? { transferProjectsTo: transferTo } : {}),
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
    <Modal title={`Supprimer ${props.targetUser.email}`} onClose={props.onClose}>
      <Hint>
        Supprime définitivement le compte, ses sessions, ses appartenances aux équipes et les invitations qu'il a
        envoyées. Les modifications qu'il a faites gardent son nom dans l'historique des projets — cet enregistrement
        n'est pas réécrit. Si vous pourriez en avoir encore besoin, désactivez le compte plutôt que de le supprimer.
      </Hint>

      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        Projets dont il est propriétaire
        <select className={`${SELECT_CLASS} mt-1 w-full`} value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
          <option value="">Laisser sans propriétaire (seuls les admins pourront les gérer)</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              Transférer à {u.displayName} ({u.email})
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        Saisissez <span className="font-mono text-text">{props.targetUser.email}</span> pour confirmer
        <input
          className={`${INPUT_CLASS} mt-1 w-full`}
          value={confirmation}
          autoFocus
          autoComplete="off"
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>

      <Button variant="danger" className="mt-4" onClick={submit} disabled={busy || !confirmed}>
        {busy ? "Suppression…" : "Supprimer définitivement"}
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </Modal>
  );
}
