# Webhooks

A project can notify other services when something happens to it. Project
administrators manage them from the project card (**Webhooks** button). A
project can have up to 10.

## Events

| Event                  | Sent when                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.changed`       | The schema changed, once the project has seen **30 seconds without an edit**. A burst of edits becomes one notification listing every author. Moving tables or changing colours doesn't count.                                                          |
| `deployment.completed` | A deployment or a rollback to a connected database finished — successfully or not.                                                                                                                                                                      |
| `drift.detected`       | The project's watch (Déploiements → Surveillance) found a database changed outside Athanor since the last deployment or pull — or, with the accounts watch on, its accounts or privileges changed (`kind: "accounts"`). Once per state of the database. |
| `ping`                 | Only when someone clicks **Tester** — never subscribed to.                                                                                                                                                                                              |

## Formats

- **JSON signé** (`json`): the full event, below. Use this for your own endpoints.
- **Slack** (`slack`): `{ "text": "…" }` — paste a Slack _incoming webhook_ URL.
- **Discord** (`discord`): `{ "content": "…" }` — paste a Discord channel webhook URL.

Slack and Discord messages are short French sentences built from the event.

## The JSON payload

```json
{
  "id": "5b0c…",
  "event": "schema.changed",
  "occurredAt": "2026-09-23T21:14:07.512Z",
  "project": { "id": "…", "name": "Shop", "url": "https://schemas.example.com/project/…" },
  "data": {
    "authors": ["Alice"],
    "changes": { "tablesAdded": 2, "tablesRemoved": 0, "tablesChanged": 1, "refsChanged": 1 },
    "tableCount": 8
  }
}
```

`project.url` is `null` unless `ATHANORDB_PUBLIC_URL` is set. `data.changes` is
`null` in the rare case the server has no earlier state to compare with.

For `deployment.completed`, `data` is `{ kind: "deploy" | "rollback",
connectionName, environment, engine, success, executedStatements, error,
executedBy }` — `executedBy` is the email of the person who ran it.

For `drift.detected`, `data` is `{ kind: "external" | "partial-deployment",
connectionName, environment, added, removed, changed }` — the last three are
table names. `partial-deployment` means a deployment failed half-way since the
reference and explains the change.

When an instance administrator turned on the project's **accounts watch**,
`drift.detected` is also sent with `kind: "accounts"`: the database's accounts,
roles or privileges changed and no action in Athanor's console explains it.
`data` is then `{ kind: "accounts", connectionName, environment, added: [],
removed: [], changed: [], accountChanges }`, where `accountChanges` counts the
changes by type (`{ "created": 1, "privilege-granted": 2 }`; the types are
`created`, `dropped`, `locked`, `unlocked`, `login-granted`, `login-removed`,
`superuser-granted`, `superuser-removed`, `role-granted`, `role-revoked`,
`privilege-granted`, `privilege-revoked`). Account names are deliberately left
out of the webhook: the webhook's address is chosen by a project administrator,
the names are for the instance administrators, in the app. A receiver that
only expects tables should check `kind`.

`id` is the same for every retry of one delivery: use it to ignore duplicates.

## Verifying the signature

Every request carries:

- `X-AthanorDB-Event` — the event name
- `X-AthanorDB-Delivery` — the delivery id (same as `id` in the body)
- `X-AthanorDB-Signature` — `t=<unix seconds>,v1=<hex HMAC-SHA256>`

The HMAC is computed over `<t>.<raw request body>` with the webhook's signing
secret (`whsec_…`, shown **once**, when the webhook is created). Check it
against the raw body, before parsing, and reject old timestamps to stop replays:

```js
import crypto from "node:crypto";

function isFromAthanorDB(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? "");
  if (!match) return false;
  const [, t, v1] = match;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Lost the secret, or it leaked? **Régénérer le secret** on the webhook (or
`POST …/webhooks/:hookId/rotate-secret`) gives it a new one — shown once, like
the first — and keeps its address, events and delivery log. The old secret
stops signing at once, including for a delivery still waiting to be retried:
put the new one in the receiving service straight away.

## Delivery and retries

- A delivery succeeds on any `2xx` answer within 10 seconds. Redirects are
  **not** followed — a `3xx` is a failure.
- A failure is retried after 1 min, 5 min, 30 min, 2 h and 6 h, then abandoned.
  Retries survive a server restart.
- After **20 abandoned deliveries in a row**, the webhook switches itself off;
  the reason is shown in the list. Ticking **Actif** again resets the count.
- **Historique** lists the last 20 deliveries. The delivery log is kept 30 days.
  The response body of the receiving service is never read or stored.

## Security

- Only project administrators can see or change a project's webhooks.
- The signing secret is stored encrypted with `ATHANORDB_SECRET`, which must
  be set (same requirement as database connections). Changing that key makes
  existing secrets unreadable: those webhooks' deliveries then fail with an
  explicit error until they are recreated.
- URLs must be `http(s)` and can't carry credentials. The cloud metadata
  endpoint is refused — checked against the address actually connected to,
  so a hostname that changes its DNS answer can't get around it. Like database
  connections, private and LAN addresses are allowed on purpose (an internal
  chat or CI server is the normal case for a self-hosted instance).
- Payloads carry the project name, change counts and, for deployments, the
  deployer's email. Nothing of the schema itself is sent.
