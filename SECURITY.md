# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability
reporting (the **Security** tab → _Report a vulnerability_) rather than a
public issue, so the problem can be fixed before it is described publicly.

Please include what you did, what happened, and what you expected — a request,
a payload, or a short script is worth more than a scanner report. There is no
bug bounty.

## What this project protects, and what it does not

AthanorDB is self-hosted. Its threat model assumes an operator who controls the
server and a set of accounts that are not all equally trusted.

**In scope** — anything letting someone:

- authenticate as another user, or keep access after their account is disabled
  or deleted;
- read or modify a project they were not granted access to (including through a
  hand-crafted WebSocket frame — the sync protocol enforces permissions
  server-side, not in the UI);
- escalate from a `view` grant to writing, or from a normal account to
  administrator;
- take the server down or exhaust its resources from an unauthenticated
  request.

**Out of scope**, because they are properties of the deployment rather than the
software:

- Anyone with filesystem access to the SQLite database can read and alter
  everything, including the audit log. The audit trail is append-only _through
  the application_; it is not tamper-evident against server access.
- Running without TLS. Sessions are cookie-based; deploy behind HTTPS and set
  `ATHANORDB_COOKIE_SECURE=true` (the server warns at boot if you don't in
  production).
- Users you gave administrator to. Global admins can read every project by
  design.

A live database connection (below) is the one feature area where a mistake can
destroy a client's data, not just leak it — treat findings there as higher
severity by default.

**Also in scope, for a project's live database connection**
(`apps/server/src/modules/connections/`) — a project can be linked to a real
Postgres/MySQL/SQLite database for introspection and schema deployment:

- SSRF against the server's own network via a crafted connection host, beyond
  what `hostGuard.ts` already blocks (loopback/link-local/metadata addresses
  and unresolvable hosts). **Known gap, not yet closed:** `hostGuard.ts`
  resolves-then-checks a hostname — a name that resolves safely at save time
  and points elsewhere at actual connect time (DNS rebinding) still gets
  through. Tracked in `docs/todo.md` Phase 27.
- Reading or exfiltrating another project's stored connection credentials, or
  the `ATHANORDB_SECRET` encryption key.
- Getting the deployment wizard to execute SQL beyond what it showed in the
  preview, or bypassing its explicit-confirmation step.

## Known limitations worth stating plainly

- **No transactional email.** Invitations are relayed by hand, so an invite
  link is a live account-creation credential — send it over a trusted channel.
  There is no self-service password reset for the same reason.
- **No SSO, no passkeys.** TOTP two-factor authentication exists (per-account,
  optional, _Settings → Profile_); password plus an optional TOTP code plus a
  session cookie is the full authentication surface.
- **Partial encryption at rest.** Passwords are hashed (scrypt, N=65536).
  Live-database-connection credentials and TOTP secrets are encrypted
  (AES-256-GCM, keyed by `ATHANORDB_SECRET` — see the README's Configuration
  section) — but schema contents themselves are not encrypted in the database
  file, and there is no general at-rest encryption of the SQLite file.
- **Single instance.** SQLite plus in-process room state means one server
  process per database file. Two containers on the same volume will corrupt
  state.

## Supported versions

The project is pre-1.0: fixes land on `main`, and there are no backports to
older tags. Self-hosters should track `main`.
