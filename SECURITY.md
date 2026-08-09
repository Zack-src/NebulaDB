# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability
reporting (the **Security** tab → *Report a vulnerability*) rather than a
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
  everything, including the audit log. The audit trail is append-only *through
  the application*; it is not tamper-evident against server access.
- Running without TLS. Sessions are cookie-based; deploy behind HTTPS and set
  `ATHANORDB_COOKIE_SECURE=true` (the server warns at boot if you don't in
  production).
- Users you gave administrator to. Global admins can read every project by
  design.
- The `esbuild` development-server advisory reported by `npm audit`: it affects
  `npm run dev` only, never a built deployment.

## Known limitations worth stating plainly

- **No transactional email.** Invitations are relayed by hand, so an invite
  link is a live account-creation credential — send it over a trusted channel.
  There is no self-service password reset for the same reason.
- **No 2FA and no SSO.** Password plus session cookie is the only
  authentication method.
- **No encryption at rest.** Passwords are hashed (scrypt, N=65536); schema
  contents are not encrypted in the database file.
- **Single instance.** SQLite plus in-process room state means one server
  process per database file. Two containers on the same volume will corrupt
  state.

## Supported versions

The project is pre-1.0: fixes land on `main`, and there are no backports to
older tags. Self-hosters should track `main`.
