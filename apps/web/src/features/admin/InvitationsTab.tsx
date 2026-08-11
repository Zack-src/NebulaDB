import { useState } from "react";
import { LinkIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText } from "@/components/ui/Alert";
import { List, ListMain, ListRow, EmptyState } from "@/components/ui/List";
import { CHECKBOX_CLASS, INPUT_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import { createInvitation, fetchInvitations, revokeInvitation } from "@/services/invitationsApi";
import type { InvitationSummary, TranslationKeyOf } from "@/types";

const STATUS_TONE = { pending: "warning", accepted: "success", expired: "danger" } as const;
const STATUS_LABEL_KEY = {
  pending: "admin.invitations.status.pending",
  accepted: "admin.invitations.status.accepted",
  expired: "admin.invitations.status.expired",
} as const satisfies Record<InvitationSummary["status"], TranslationKeyOf>;

const COPIED_FEEDBACK_MS = 1500;

export function InvitationsTab() {
  const { t } = useTranslation();
  const invitations = useAsyncResource(fetchInvitations);
  const [email, setEmail] = useState("");
  const [invitingAsAdmin, setInvitingAsAdmin] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const invite = useAsyncAction(async () => {
    await createInvitation(email.trim(), invitingAsAdmin);
    setEmail("");
    setInvitingAsAdmin(false);
    invitations.reload();
  });

  const revoke = useAsyncAction(async (token: string) => {
    await revokeInvitation(token);
    invitations.reload();
  });

  const handleInvite = () => {
    if (email.trim()) void invite.run();
  };

  const copyInviteLink = (invitation: InvitationSummary) => {
    void navigator.clipboard.writeText(`${location.origin}/invite/${invitation.token}`).then(() => {
      setCopiedToken(invitation.token);
      // Only clears its own feedback: copying a second link before the first
      // timer fires must not blank the newer confirmation.
      setTimeout(
        () => setCopiedToken((current) => (current === invitation.token ? null : current)),
        COPIED_FEEDBACK_MS,
      );
    });
  };

  const rows = invitations.data ?? [];
  const error = invitations.error ?? invite.error ?? revoke.error;

  return (
    <div>
      <div className="mb-7 flex max-w-[420px] items-center gap-2">
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder={t("admin.invitations.emailPlaceholder")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && handleInvite()}
        />
        <label className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-text-muted">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={invitingAsAdmin}
            onChange={(event) => setInvitingAsAdmin(event.target.checked)}
          />
          {t("common.admin")}
        </label>
        <Button variant="primary" onClick={handleInvite} disabled={invite.pending || !email.trim()}>
          <PlusIcon size={14} /> {t("admin.invitations.invite")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {rows.length === 0 ? (
        <EmptyState>{invitations.loading ? t("common.loading") : t("admin.invitations.empty")}</EmptyState>
      ) : (
        <List>
          {rows.map((invitation) => (
            <ListRow key={invitation.token}>
              <ListMain>
                <span>{invitation.email}</span>
                {invitation.isAdmin && <Badge tone="admin">{t("common.admin")}</Badge>}
              </ListMain>
              <Badge tone={STATUS_TONE[invitation.status]}>{t(STATUS_LABEL_KEY[invitation.status])}</Badge>
              {invitation.status === "pending" && (
                <>
                  <Button size="sm" onClick={() => copyInviteLink(invitation)}>
                    <LinkIcon size={12} />{" "}
                    {copiedToken === invitation.token ? t("common.copied") : t("admin.invitations.copyLink")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-tooltip={t("admin.invitations.revoke")}
                    onClick={() => void revoke.run(invitation.token)}
                  >
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
