import { useEffect, useState } from "react";
import { LinkIcon, PlusIcon, TrashIcon } from "../Icons.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { ErrorText } from "../ui/Alert.js";
import { List, ListMain, ListRow, EmptyState } from "../ui/List.js";
import { CHECKBOX_CLASS, INPUT_CLASS } from "../ui/inputStyles.js";
import type { InvitationSummary } from "../types.js";

const STATUS_TONE = { pending: "warning", accepted: "success", expired: "danger" } as const;

export function InvitationsTab() {
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const refresh = () => {
    fetch("/api/invitations")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`list failed (${r.status})`))))
      .then(setInvitations)
      .catch((err) => setError((err as Error).message));
  };

  useEffect(refresh, []);

  const create = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, isAdmin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmail("");
        setIsAdmin(false);
        refresh();
      } else {
        setError(data.error ?? `Invite failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    await fetch(`/api/invitations/${token}`, { method: "DELETE" });
    refresh();
  };

  const copyLink = (inv: InvitationSummary) => {
    navigator.clipboard.writeText(`${location.origin}/invite/${inv.token}`).then(() => {
      setCopiedToken(inv.token);
      setTimeout(() => setCopiedToken((t) => (t === inv.token ? null : t)), 1500);
    });
  };

  return (
    <div>
      <div className="mb-7 flex max-w-[420px] items-center gap-2">
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder="Email à inviter"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <label className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-text-muted">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          Admin
        </label>
        <Button variant="primary" onClick={create} disabled={busy || !email.trim()}>
          <PlusIcon size={14} /> Inviter
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {invitations.length === 0 ? (
        <EmptyState>Aucune invitation pour le moment.</EmptyState>
      ) : (
        <List>
          {invitations.map((inv) => (
            <ListRow key={inv.token}>
              <ListMain>
                <span>{inv.email}</span>
                {inv.isAdmin && <Badge tone="admin">Admin</Badge>}
              </ListMain>
              <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
              {inv.status === "pending" && (
                <>
                  <Button size="sm" onClick={() => copyLink(inv)}>
                    <LinkIcon size={12} /> {copiedToken === inv.token ? "Copié" : "Copier le lien"}
                  </Button>
                  <Button variant="ghost" size="icon" data-tooltip="Révoquer" onClick={() => revoke(inv.token)}>
                    <TrashIcon size={13} />
                  </Button>
                </>
              )}
            </ListRow>
          ))}
        </List>
      )}
    </div>
  );
}
