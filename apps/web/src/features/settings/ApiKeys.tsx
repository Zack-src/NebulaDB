import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { ErrorText } from "@/components/ui/Alert";
import { CHECKBOX_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatRelativeTime } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { API_KEY_SCOPES, createApiKey, listApiKeys, revokeApiKey, type ApiKeyScope } from "@/services/apiKeysApi";
import type { TranslationKeyOf } from "@/types";

/**
 * Self-service `/api/v1` key management — create, list (redacted), revoke.
 * Closes the gap the billing tab used to describe explicitly ("there is no
 * public API and no API keys yet"); see `docs/todo.md` Phase 21.
 *
 * The plaintext key is shown exactly once, right after creation — the server
 * only ever stores its hash (`apiKeys/repository.ts`), so this component is
 * the only place in the app it's ever visible.
 */

const SCOPE_LABEL_KEY: Record<ApiKeyScope, TranslationKeyOf> = {
  "projects:read": "settings.billing.apiKeys.scope.read",
  "projects:write": "settings.billing.apiKeys.scope.write",
  "deployments:trigger": "settings.billing.apiKeys.scope.deploy",
  "connections:manage": "settings.billing.apiKeys.scope.connections",
  "teams:manage": "settings.billing.apiKeys.scope.teams",
};

export function ApiKeys() {
  const { t, locale } = useTranslation();
  const keys = useAsyncResource(listApiKeys);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const create = useAsyncAction(async () => {
    const result = await createApiKey(name.trim(), scopes);
    setJustCreated(result.plaintextKey);
    setName("");
    setScopes([]);
    keys.reload();
  });

  const revoke = useAsyncAction(async (id: string) => {
    await revokeApiKey(id);
    keys.reload();
  });

  function toggleScope(scope: ApiKeyScope) {
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  }

  const rows = (keys.data ?? []).filter((k) => !k.revokedAt);
  const error = keys.error ?? create.error ?? revoke.error;

  return (
    <div className="space-y-2 pt-4 border-t border-border/60">
      <h3 className="text-xs font-bold text-text">{t("settings.billing.apiKeysTitle")}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{t("settings.billing.apiKeys.intro")}</p>

      {error && <ErrorText>{error}</ErrorText>}

      {justCreated && (
        <div className="rounded-lg border border-primary/50 bg-primary/10 p-3 space-y-2">
          <p className="text-xs font-semibold text-text">{t("settings.billing.apiKeys.createdOnce")}</p>
          <code className="block break-all rounded-md bg-surface-raised px-2 py-1.5 text-[11.5px] text-text">
            {justCreated}
          </code>
          <Button size="sm" variant="outline" onClick={() => setJustCreated(null)}>
            {t("settings.billing.apiKeys.dismiss")}
          </Button>
        </div>
      )}

      <ul className="space-y-2 max-w-2xl">
        {rows.map((key) => (
          <li
            key={key.id}
            className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-text truncate">{key.name}</span>
                <code className="text-[11px] text-text-muted">{key.keyPrefix}…</code>
                {key.scopes.map((scope) => (
                  <Badge key={scope} tone="muted">
                    {t(SCOPE_LABEL_KEY[scope])}
                  </Badge>
                ))}
              </div>
              <div className="text-text-muted mt-0.5">
                {key.lastUsedAt
                  ? t("settings.billing.apiKeys.lastUsed", { time: formatRelativeTime(key.lastUsedAt, locale) })
                  : t("settings.billing.apiKeys.neverUsed")}
              </div>
            </div>
            <Button variant="danger-ghost" size="sm" disabled={revoke.pending} onClick={() => void revoke.run(key.id)}>
              {t("settings.billing.apiKeys.revoke")}
            </Button>
          </li>
        ))}
      </ul>

      <div className="max-w-md pt-2">
        <Field
          label={t("settings.billing.apiKeys.nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.billing.apiKeys.namePlaceholder")}
        />
        <div className="flex flex-col gap-1.5 mb-4">
          {API_KEY_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {t(SCOPE_LABEL_KEY[scope])}
            </label>
          ))}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={create.pending || !name.trim() || scopes.length === 0}
          onClick={() => void create.run()}
        >
          {t("settings.billing.apiKeys.create")}
        </Button>
      </div>
    </div>
  );
}
