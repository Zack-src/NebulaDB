import type { OutgoingMail } from "../infrastructure/mailer.js";

/**
 * Transactional email bodies. French, like the rest of the UI (the i18n
 * decision in `docs/todo.md`): the server has no per-user locale to pick
 * from, and the instance's language is French. Every mail carries a plain-text
 * part — some clients and most security-conscious readers only ever see that
 * one — and a minimal inline-styled HTML part (no external images, no
 * tracking: a self-hosted tool shouldn't phone anywhere from an inbox).
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, paragraphs: string[], action: { label: string; url: string }, footer: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join("");
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#f4f4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2330">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;border:1px solid #e3e4ea">
<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h1>
${body}
<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#6b6f80;word-break:break-all">${escapeHtml(action.url)}</p>
<p style="margin:18px 0 0;font-size:12px;color:#6b6f80">${escapeHtml(footer)}</p>
</div></body></html>`;
}

function text(title: string, paragraphs: string[], action: { label: string; url: string }, footer: string): string {
  return [title, "", ...paragraphs.flatMap((p) => [p, ""]), `${action.label} : ${action.url}`, "", footer, ""].join(
    "\n",
  );
}

function build(
  to: string,
  subject: string,
  paragraphs: string[],
  action: { label: string; url: string },
  footer: string,
): OutgoingMail {
  return {
    to,
    subject,
    text: text(subject, paragraphs, action, footer),
    html: layout(subject, paragraphs, action, footer),
  };
}

export function invitationEmail(to: string, url: string, invitedBy: string, expiresAt: Date): OutgoingMail {
  return build(
    to,
    "Invitation à rejoindre AthanorDB",
    [
      `${invitedBy} vous invite à créer un compte sur AthanorDB, l'éditeur de schémas de bases de données de votre équipe.`,
      `Ce lien est valable jusqu'au ${formatDate(expiresAt)} et ne peut servir qu'une fois.`,
    ],
    { label: "Créer mon compte", url },
    "Si vous n'attendiez pas cette invitation, ignorez simplement ce message : aucun compte ne sera créé.",
  );
}

export function passwordResetEmail(to: string, url: string, ttlMinutes: number): OutgoingMail {
  return build(
    to,
    "Réinitialisation de votre mot de passe AthanorDB",
    [
      "Une réinitialisation du mot de passe de votre compte AthanorDB a été demandée.",
      `Ce lien est valable ${ttlMinutes} minutes et ne peut servir qu'une fois. Choisir un nouveau mot de passe déconnectera toutes vos sessions ouvertes.`,
    ],
    { label: "Choisir un nouveau mot de passe", url },
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
  );
}

function formatDate(date: Date): string {
  return (
    new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date) + " (UTC)"
  );
}
