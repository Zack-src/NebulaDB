import { useEffect, useState } from "react";
import type { DatabaseConnectionConfig, DatabaseConnectionSummary, DatabaseEngine } from "@athanordb/shared";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { CheckCircleIcon, CheckIcon, DatabaseIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";
import {
  createProjectConnection,
  deleteProjectConnection,
  listProjectConnections,
  pullDatabaseSchema,
  testConnectionConfig,
  updateProjectConnection,
} from "@/services/connectionsApi";
import { ConnectionFormFields, DEFAULT_PORTS } from "./ConnectionFormFields";

export function ConnectionManagerModal(props: {
  projectId: string;
  onClose: () => void;
  onSelectActiveConnection?: (conn: DatabaseConnectionSummary) => void;
  activeConnectionId?: string | null;
  /** Opens the read-only diff view (`DeploymentModal` in `readOnly` mode) for the given connection, without going through the deploy flow. */
  onCheckDifferences?: (connId: string) => void;
}) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | "new">("new");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
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
  const [filePath, setFilePath] = useState("");
  const [useUri, setUseUri] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);

  const selectConnection = (conn: DatabaseConnectionSummary) => {
    setSelectedId(conn.id);
    setName(conn.name);
    setEnvironment(conn.environment || "");
    setEngine(conn.engine);
    setHost(conn.host || "localhost");
    setPort(conn.port || DEFAULT_PORTS[conn.engine] || 5432);
    setDatabase(conn.database || "");
    setUser(conn.user || "");
    setPassword("");
    setSsl(Boolean(conn.ssl));
    setConnectionString(conn.connectionString || "");
    setFilePath(conn.filePath || "");
    setUseUri(Boolean(conn.connectionString));
    setTestResult(null);
    setError(null);
    setSuccessMessage(null);
  };

  /** Reusable for the manual reload after a save/delete; the mount fetch below is a separate inline chain — see its own comment. */
  const load = async () => {
    try {
      setLoading(true);
      const list = await listProjectConnections(props.projectId);
      setConnections(list);
      if (list.length > 0 && selectedId === "new") {
        selectConnection(list[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    // Deliberately not `void load()`: an effect calling a named async
    // function whose body opens with a synchronous `setLoading(true)` is
    // exactly what `react-hooks/set-state-in-effect` flags — see
    // `useAsyncResource.ts` for the same shape with the same justification.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch this same effect kicks off
    setLoading(true);
    listProjectConnections(props.projectId)
      .then((list) => {
        if (!active) return;
        setConnections(list);
        if (list.length > 0 && selectedId === "new") selectConnection(list[0]);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  const handleNew = () => {
    setSelectedId("new");
    setName("Dev Database");
    setEnvironment("");
    setEngine("postgres");
    setHost("localhost");
    setPort(5432);
    setDatabase("my_database");
    setUser("postgres");
    setPassword("");
    setSsl(false);
    setConnectionString("");
    setFilePath("./data/dev.sqlite");
    setUseUri(false);
    setTestResult(null);
    setError(null);
    setSuccessMessage(null);
  };

  const getFormPayload = (): DatabaseConnectionConfig => ({
    id: selectedId === "new" ? "" : selectedId,
    projectId: props.projectId,
    name: name.trim() || "Database",
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

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await testConnectionConfig(props.projectId, getFormPayload());
      if (res.ok) {
        setTestResult({
          ok: true,
          message: `${t("connections.testSuccess")}: ${res.version ?? ""} ${res.database ? `(${res.database})` : ""}`,
        });
      } else {
        setTestResult({
          ok: false,
          message: res.error || t("connections.testFailed"),
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = getFormPayload();
      let saved: DatabaseConnectionSummary;
      if (selectedId === "new") {
        saved = await createProjectConnection(props.projectId, payload);
      } else {
        saved = await updateProjectConnection(props.projectId, selectedId, payload);
      }
      setSuccessMessage(t("common.saved"));
      await load();
      selectConnection(saved);
      if (props.onSelectActiveConnection) {
        props.onSelectActiveConnection(saved);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("connections.confirmDelete"))) return;
    try {
      await deleteProjectConnection(props.projectId, id);
      const list = await listProjectConnections(props.projectId);
      setConnections(list);
      if (list.length > 0) selectConnection(list[0]);
      else handleNew();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePullSchema = async () => {
    if (selectedId === "new") return;
    if (!window.confirm(t("connections.confirmPull"))) return;
    setPulling(true);
    setError(null);
    try {
      const res = await pullDatabaseSchema(props.projectId, selectedId);
      setSuccessMessage(t("connections.pulledSuccess", { count: res.tablesCount }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  };

  return (
    <Modal title={t("connections.title")} onClose={props.onClose} wide>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* Sidebar: list of connections */}
        <div className="space-y-2 md:col-span-4 md:border-r md:border-border md:pr-4">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("connections.savedConnections")}
            </span>
            <Button size="xs" variant="ghost" onClick={handleNew}>
              <PlusIcon size={12} /> {t("common.add")}
            </Button>
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {connections.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectConnection(c)}
                  className={`flex w-full items-center justify-between rounded-sm px-2.5 py-2 text-left text-xs transition-colors ${
                    active ? "bg-accent/15 font-semibold text-accent" : "text-text hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <DatabaseIcon size={13} className="shrink-0 text-text-muted" />
                    <span className="truncate">{c.name}</span>
                    {c.environment && (
                      <span className="shrink-0 truncate text-[10px] text-text-muted">({c.environment})</span>
                    )}
                  </div>
                  <Badge tone={c.engine === "postgres" ? "admin" : c.engine === "mysql" ? "warning" : "muted"}>
                    {c.engine}
                  </Badge>
                </button>
              );
            })}

            {connections.length === 0 && !loading && (
              <p className="py-4 text-center text-xs text-text-muted">{t("connections.noConnections")}</p>
            )}
          </div>
        </div>

        {/* Right pane: form configuration */}
        <div className="space-y-4 md:col-span-8">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-text">
              {selectedId === "new" ? t("connections.newConnection") : t("connections.editConnection")}
            </h3>
            {selectedId !== "new" && (
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="danger" onClick={() => handleDelete(selectedId)}>
                  <TrashIcon size={12} /> {t("common.delete")}
                </Button>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">{t("common.name")}</label>
            <input
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Production DB"
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
            passwordPlaceholder={selectedId !== "new" ? "••••••••" : ""}
            ssl={ssl}
            onSslChange={setSsl}
            connectionString={connectionString}
            onConnectionStringChange={setConnectionString}
            filePath={filePath}
            onFilePathChange={setFilePath}
            useUri={useUri}
            onUseUriChange={setUseUri}
          />

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-sm border p-2 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-400"
              }`}
            >
              {testResult.ok ? <CheckCircleIcon size={14} /> : null}
              <span>{testResult.message}</span>
            </div>
          )}

          {successMessage && <Hint>{successMessage}</Hint>}
          {error && <ErrorText>{error}</ErrorText>}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleTest} disabled={testing}>
                {testing ? t("common.loading") : t("connections.testConnection")}
              </Button>
              {selectedId !== "new" && (
                <Button size="sm" variant="ghost" onClick={handlePullSchema} disabled={pulling}>
                  {pulling ? t("common.loading") : t("connections.pullSchema")}
                </Button>
              )}
              {selectedId !== "new" && props.onCheckDifferences && (
                <Button size="sm" variant="ghost" onClick={() => props.onCheckDifferences!(selectedId)}>
                  {t("connections.checkDifferences")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={props.onClose}>
                {t("common.close")}
              </Button>
              <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                <CheckIcon size={13} /> {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
