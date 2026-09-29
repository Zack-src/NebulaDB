import type { DatabaseEngine } from "@athanordb/shared";
import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
import { Hint } from "@/components/ui/Alert";
import { useTranslation } from "@/i18n/useTranslation";

export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
  mssql: 1433,
  // Not yet offered by the engine picker below — the backend supports it
  // (`apps/server/.../drivers/oracle.ts`), but wiring it into this form is a
  // separate piece of work from what added this constant.
  oracle: 1521,
};

/**
 * The connection-config form fields, shared by `ConnectionManagerModal`
 * (editing a project's existing connections) and `NewProjectFromDatabaseModal`
 * (entering one before a project even exists) — extracted so the two don't
 * drift out of sync on engine support, field layout, or validation as either
 * one changes. Each field is a plain controlled prop rather than a bundled
 * object so lifting this out of `ConnectionManagerModal` stayed a mechanical
 * "pass the existing state through" instead of a state-shape rewrite.
 */
export function ConnectionFormFields(props: {
  environment: string;
  onEnvironmentChange: (value: string) => void;
  engine: DatabaseEngine;
  onEngineChange: (engine: DatabaseEngine) => void;
  host: string;
  onHostChange: (value: string) => void;
  port: number;
  onPortChange: (value: number) => void;
  database: string;
  onDatabaseChange: (value: string) => void;
  user: string;
  onUserChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  passwordPlaceholder?: string;
  ssl: boolean;
  onSslChange: (value: boolean) => void;
  connectionString: string;
  onConnectionStringChange: (value: string) => void;
  filePath: string;
  onFilePathChange: (value: string) => void;
  useUri: boolean;
  onUseUriChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  const handleEngineChange = (nextEngine: DatabaseEngine) => {
    props.onEngineChange(nextEngine);
    props.onPortChange(DEFAULT_PORTS[nextEngine] || 5432);
    if (nextEngine === "sqlite" && !props.filePath) {
      props.onFilePathChange("./data/database.sqlite");
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.engine")}</label>
          <select
            className={SELECT_CLASS}
            value={props.engine}
            onChange={(e) => handleEngineChange(e.target.value as DatabaseEngine)}
          >
            <option value="postgres">{t("connections.engine.postgres")}</option>
            <option value="mysql">{t("connections.engine.mysql")}</option>
            <option value="mssql">{t("connections.engine.mssql")}</option>
            <option value="sqlite">{t("connections.engine.sqlite")}</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.environment")}</label>
          <input
            className={INPUT_CLASS}
            value={props.environment}
            onChange={(e) => props.onEnvironmentChange(e.target.value)}
            placeholder={t("connections.environmentPlaceholder")}
          />
          <Hint>{t("connections.environmentHint")}</Hint>
        </div>
      </div>

      {props.engine === "sqlite" ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.filePath")}</label>
          <input
            className={INPUT_CLASS}
            value={props.filePath}
            onChange={(e) => props.onFilePathChange(e.target.value)}
            placeholder="./data/app.sqlite"
          />
          <Hint>{t("connections.sqliteHint")}</Hint>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text">
              <input
                type="checkbox"
                checked={props.useUri}
                onChange={(e) => props.onUseUriChange(e.target.checked)}
                className="rounded border-border"
              />
              {t("connections.useUri")}
            </label>
          </div>

          {props.useUri ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.connectionUri")}</label>
              <input
                className={INPUT_CLASS}
                type="password"
                value={props.connectionString}
                onChange={(e) => props.onConnectionStringChange(e.target.value)}
                placeholder={
                  props.engine === "postgres"
                    ? "postgres://user:pass@host:5432/dbname"
                    : props.engine === "mssql"
                      ? "mssql://user:pass@host:1433/dbname"
                      : "mysql://user:pass@host:3306/dbname"
                }
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.host")}</label>
                  <input className={INPUT_CLASS} value={props.host} onChange={(e) => props.onHostChange(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.port")}</label>
                  <input
                    className={INPUT_CLASS}
                    type="number"
                    value={props.port}
                    onChange={(e) => props.onPortChange(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.database")}</label>
                  <input
                    className={INPUT_CLASS}
                    value={props.database}
                    onChange={(e) => props.onDatabaseChange(e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.user")}</label>
                  <input className={INPUT_CLASS} value={props.user} onChange={(e) => props.onUserChange(e.target.value)} />
                </div>
                <div className="col-span-1">
                  <label className="mb-1 block text-xs font-medium text-text-muted">{t("connections.password")}</label>
                  <input
                    className={INPUT_CLASS}
                    type="password"
                    value={props.password}
                    onChange={(e) => props.onPasswordChange(e.target.value)}
                    placeholder={props.passwordPlaceholder ?? ""}
                  />
                </div>
              </div>

              <div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={props.ssl}
                    onChange={(e) => props.onSslChange(e.target.checked)}
                    className="rounded border-border"
                  />
                  {t("connections.sslEnable")}
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
