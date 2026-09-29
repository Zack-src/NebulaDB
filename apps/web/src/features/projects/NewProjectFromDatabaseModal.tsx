import { useState } from "react";
import type { DatabaseEngine } from "@athanordb/shared";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";
import { describeApiError } from "@/i18n/serverErrorMessages";
import { ConnectionFormFields } from "@/features/connections/ConnectionFormFields";
import type { CreateProjectFromDatabaseResponse } from "@/services/connectionsApi";
import * as connectionsApi from "@/services/connectionsApi";

/**
 * "New Project from Database": the counterpart to Athanor's existing
 * project-to-database deploy flow. There is no project to attach a
 * connection to yet, so unlike `ConnectionManagerModal` this has no separate
 * "Test Connection" step against `/api/projects/:id/connections/test` (that
 * route needs a project id) — submitting *is* the test: the server creates
 * the project, saves the connection, and introspects the live schema into it
 * in one call, rolling all of it back if introspection fails (see
 * `createProjectFromDatabase` server-side), so a bad host/credentials never
 * leaves a stray empty project behind.
 */
export function NewProjectFromDatabaseModal(props: {
  onClose: () => void;
  onCreated: (result: CreateProjectFromDatabaseResponse) => void;
}) {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("");
  const [engine, setEngine] = useState<DatabaseEngine>("postgres");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(5432);
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("postgres");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [filePath, setFilePath] = useState("./data/dev.sqlite");
  const [useUri, setUseUri] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const connectionName = name.trim() || database.trim() || t("connections.newConnection");
      const result = await connectionsApi.createProjectFromDatabase(name, {
        name: connectionName,
        environment: environment.trim() || undefined,
        engine,
        host: useUri || engine === "sqlite" ? undefined : host,
        port: useUri || engine === "sqlite" ? undefined : Number(port),
        database: useUri || engine === "sqlite" ? undefined : database,
        user: useUri || engine === "sqlite" ? undefined : user,
        password: password || undefined,
        ssl: useUri || engine === "sqlite" ? undefined : ssl,
        connectionString: useUri && engine !== "sqlite" ? connectionString : undefined,
        filePath: engine === "sqlite" ? filePath : undefined,
      });
      props.onCreated(result);
    } catch (err) {
      setError(describeApiError(err, t));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title={t("projects.newFromDatabase")} onClose={props.onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-text-muted">{t("projects.newFromDatabaseDesc")}</p>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">{t("projects.projectName")}</label>
          <input
            className={INPUT_CLASS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("projects.projectNamePlaceholder")}
          />
        </div>

        <ConnectionFormFields
          environment={environment}
          onEnvironmentChange={setEnvironment}
          engine={engine}
          onEngineChange={setEngine}
          host={host}
          onHostChange={setHost}
          port={port}
          onPortChange={setPort}
          database={database}
          onDatabaseChange={setDatabase}
          user={user}
          onUserChange={setUser}
          password={password}
          onPasswordChange={setPassword}
          ssl={ssl}
          onSslChange={setSsl}
          connectionString={connectionString}
          onConnectionStringChange={setConnectionString}
          filePath={filePath}
          onFilePathChange={setFilePath}
          useUri={useUri}
          onUseUriChange={setUseUri}
        />

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button size="sm" variant="ghost" onClick={props.onClose} disabled={creating}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="primary" onClick={handleCreate} disabled={creating}>
            {creating ? t("projects.creatingFromDatabase") : t("projects.createFromDatabase")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
