import { useEffect, useState } from "react";
import type {
  ConflictResolutionStrategy,
  DatabaseConnectionSummary,
  MigrationResolutionMap,
  SchemaRisk,
} from "@athanordb/shared";

import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText } from "@/components/ui/Alert";
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, DatabaseIcon } from "@/components/icons/Icons";
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKeyOf } from "@/types";
import {
  applyDeployment,
  listProjectConnections,
  planDeployment,
  type PlanDeploymentResponse,
} from "@/services/connectionsApi";
import { copyText } from "@/utils/clipboard";
import { DeploymentHistoryPanel } from "./DeploymentHistoryPanel";

// eslint-disable-next-line complexity -- four-step wizard (diff/risks/sql/done) with per-step conditional JSX; splitting into sub-components would need to thread most of this state through as props with no behavior change, not a safe mechanical split without a test to catch a regression
export function DeploymentModal(props: {
  projectId: string;
  onClose: () => void;
  onOpenConnectionManager?: () => void;
  initialConnectionId?: string | null;
}) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<DatabaseConnectionSummary[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [plan, setPlan] = useState<PlanDeploymentResponse | null>(null);
  const [resolutions, setResolutions] = useState<MigrationResolutionMap>({});
  const [activeStep, setActiveStep] = useState<"diff" | "risks" | "sql" | "done" | "history">("diff");
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<{
    success: boolean;
    executedStatements: number;
    sql: string;
    rollbackAvailable: boolean;
    irreversibleWarnings: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load connections for this project
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const list = await listProjectConnections(props.projectId);
        setConnections(list);
        if (list.length > 0) {
          const match = props.initialConnectionId && list.some((c) => c.id === props.initialConnectionId);
          setSelectedConnId(match ? props.initialConnectionId! : list[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [props.projectId, props.initialConnectionId]);

  // Run analysis whenever the selected connection changes
  const runAnalysis = async (connId: string) => {
    if (!connId) return;
    setAnalyzing(true);
    setError(null);
    setPlan(null);
    setDeployResult(null);
    try {
      const res = await planDeployment(props.projectId, connId);
      setPlan(res);

      // Initialize resolutions from risks
      const initialRes: MigrationResolutionMap = {};
      for (const risk of res.risks) {
        let key = "";
        if (risk.columnName) {
          key = `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`;
        } else {
          key = `table:${risk.tableName.toLowerCase()}`;
        }
        initialRes[key] = {
          strategy: risk.defaultStrategy,
          value: risk.userProvidedValue,
        };
      }
      setResolutions(initialRes);
      if (res.risks.length > 0) {
        setActiveStep("risks");
      } else {
        setActiveStep("diff");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!selectedConnId) return;
    // `runAnalysis` is also called directly from the "retry" button below, so
    // it stays a component-scoped function rather than being inlined here —
    // but an effect calling it opens `setAnalyzing(true)` synchronously,
    // which is exactly what `react-hooks/set-state-in-effect` flags (see
    // `ConnectionManagerModal.tsx`'s mount fetch for the same shape).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- analysis kicked off by this same effect's own dependency change
    void runAnalysis(selectedConnId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnId]);

  const handleStrategyChange = (risk: SchemaRisk, strategy: ConflictResolutionStrategy, value?: string) => {
    const key = risk.columnName
      ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
      : `table:${risk.tableName.toLowerCase()}`;

    setResolutions((prev) => ({
      ...prev,
      [key]: {
        strategy,
        value: value !== undefined ? value : prev[key]?.value,
      },
    }));
  };

  const handleCopySql = () => {
    const sql = plan?.sqlPreview ?? "";
    void copyText(sql).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  };

  const handleApplyDeployment = async () => {
    if (!selectedConnId) return;
    setDeploying(true);
    setError(null);
    try {
      const res = await applyDeployment(props.projectId, selectedConnId, resolutions);
      setDeployResult(res);
      setActiveStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
    }
  };

  if (loading) {
    return (
      <Modal title={t("deployment.title")} onClose={props.onClose}>
        <div className="flex h-48 items-center justify-center text-xs text-text-muted">{t("common.loading")}</div>
      </Modal>
    );
  }

  if (connections.length === 0) {
    return (
      <Modal title={t("deployment.title")} onClose={props.onClose}>
        <div className="space-y-4 py-4 text-center">
          <DatabaseIcon size={32} className="mx-auto text-text-muted" />
          <div>
            <h3 className="text-sm font-bold text-text">{t("deployment.noConnectionTitle")}</h3>
            <p className="mt-1 text-xs text-text-muted">{t("deployment.noConnectionDesc")}</p>
          </div>
          <div className="flex justify-center gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            {props.onOpenConnectionManager && (
              <Button size="sm" variant="primary" onClick={props.onOpenConnectionManager}>
                {t("connections.manageConnections")}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const selectedConn = connections.find((c) => c.id === selectedConnId);
  const diff = plan?.diff;
  const risks = plan?.risks ?? [];

  return (
    <Modal title={t("deployment.title")} onClose={props.onClose} wide>
      <div className="space-y-4">
        {/* Header toolbar: connection selection */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface-raised p-2.5">
          <div className="flex items-center gap-2">
            <DatabaseIcon size={16} className="text-accent" />
            <span className="text-xs font-semibold text-text">{t("deployment.targetDatabase")}:</span>
            <select
              className={`${SELECT_CLASS} !py-1 text-xs font-medium`}
              value={selectedConnId}
              onChange={(e) => setSelectedConnId(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.engine})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" onClick={() => void runAnalysis(selectedConnId)} disabled={analyzing}>
              {analyzing ? t("deployment.analyzing") : t("deployment.refreshDiff")}
            </Button>
            {props.onOpenConnectionManager && (
              <Button size="xs" variant="ghost" onClick={props.onOpenConnectionManager}>
                {t("connections.manage")}
              </Button>
            )}
          </div>
        </div>

        {/* Step navigation tabs */}
        <div className="flex border-b border-border text-xs">
          <button
            type="button"
            className={`border-b-2 px-3 py-2 font-medium transition-colors ${
              activeStep === "diff" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
            onClick={() => setActiveStep("diff")}
          >
            {t("deployment.stepDiff")} {diff && `(${diff.tables.length})`}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium transition-colors ${
              activeStep === "risks"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text"
            }`}
            onClick={() => setActiveStep("risks")}
          >
            <span>{t("deployment.stepRisks")}</span>
            {risks.length > 0 && <Badge tone="warning">{risks.length}</Badge>}
          </button>
          <button
            type="button"
            className={`border-b-2 px-3 py-2 font-medium transition-colors ${
              activeStep === "sql" ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"
            }`}
            onClick={() => setActiveStep("sql")}
          >
            {t("deployment.stepSql")}
          </button>
          <button
            type="button"
            className={`border-b-2 px-3 py-2 font-medium transition-colors ${
              activeStep === "history"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text"
            }`}
            onClick={() => setActiveStep("history")}
          >
            {t("deployment.stepHistory")}
          </button>
          {deployResult && (
            <button
              type="button"
              className={`border-b-2 px-3 py-2 font-medium text-emerald-400 ${
                activeStep === "done" ? "border-emerald-400" : "border-transparent"
              }`}
              onClick={() => setActiveStep("done")}
            >
              {t("deployment.stepDone")}
            </button>
          )}
        </div>

        {/* Step 1: Schema Diff View */}
        {activeStep === "diff" && (
          <div className="space-y-3">
            {analyzing ? (
              <div className="flex h-48 items-center justify-center text-xs text-text-muted">
                {t("deployment.analyzingDiff")}
              </div>
            ) : !diff?.hasChanges ? (
              <div className="rounded-sm border border-border bg-surface-raised p-6 text-center text-xs text-text-muted">
                <CheckCircleIcon size={24} className="mx-auto mb-2 text-emerald-400" />
                <p className="font-semibold text-text">{t("deployment.inSync")}</p>
                <p className="mt-1">{t("deployment.inSyncDesc")}</p>
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {diff.tables.map((table) => (
                  <div key={table.name} className="rounded-sm border border-border bg-surface p-2.5 text-xs">
                    <div className="flex items-center justify-between pb-1">
                      <span className="font-mono font-bold text-text">
                        {table.status === "added" && <span className="text-emerald-400">+ </span>}
                        {table.status === "dropped" && <span className="text-rose-400">- </span>}
                        {table.status === "modified" && <span className="text-amber-400">~ </span>}
                        {table.name}
                      </span>
                      <Badge
                        tone={table.status === "added" ? "admin" : table.status === "dropped" ? "danger" : "warning"}
                      >
                        {table.status}
                      </Badge>
                    </div>

                    {table.fields.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-t border-border/50 pl-2 pt-1 font-mono text-[11px]">
                        {table.fields.map((f) => (
                          <div key={f.name} className="flex items-center justify-between text-text-muted">
                            <div>
                              {f.status === "added" && <span className="text-emerald-400">+ </span>}
                              {f.status === "dropped" && <span className="text-rose-400">- </span>}
                              {f.status === "modified" && <span className="text-amber-400">~ </span>}
                              <span>{f.name}</span>
                              {f.typeChanged && (
                                <span className="text-text">
                                  {" "}
                                  ({f.before?.type} → {f.after?.type})
                                </span>
                              )}
                              {f.notNullChanged && (
                                <span className="text-amber-400"> [{f.after?.notNull ? "NOT NULL" : "NULL"}]</span>
                              )}
                            </div>
                            <span className="text-[10px] text-text-muted">{f.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Risk and Conflict Resolution */}
        {activeStep === "risks" && (
          <div className="space-y-4">
            {risks.length === 0 ? (
              <div className="rounded-sm border border-emerald-500/20 bg-emerald-500/10 p-4 text-center text-xs text-emerald-400">
                <CheckCircleIcon size={20} className="mx-auto mb-1.5" />
                <p className="font-semibold">{t("deployment.noRisksDetected")}</p>
                <p className="mt-0.5 text-text-muted">{t("deployment.noRisksDesc")}</p>
              </div>
            ) : (
              <div className="max-h-84 space-y-3 overflow-y-auto pr-1">
                {risks.map((risk) => {
                  const key = risk.columnName
                    ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
                    : `table:${risk.tableName.toLowerCase()}`;
                  const currentRes = resolutions[key];

                  return (
                    <div
                      key={risk.id}
                      className={`rounded-sm border p-3.5 text-xs ${
                        risk.severity === "critical"
                          ? "border-rose-500/40 bg-rose-500/5"
                          : "border-amber-500/40 bg-amber-500/5"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertTriangleIcon
                          size={16}
                          className={risk.severity === "critical" ? "text-rose-400" : "text-amber-400"}
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="font-bold text-text">
                              {risk.type === "DROP_COLUMN_WITH_DATA" && (
                                <span>
                                  {t("deployment.riskDropColumn", {
                                    col: risk.columnName || "",
                                    table: risk.tableName,
                                  })}
                                </span>
                              )}
                              {risk.type === "DROP_TABLE_WITH_DATA" && (
                                <span>{t("deployment.riskDropTable", { table: risk.tableName })}</span>
                              )}
                              {risk.type === "ALTER_COLUMN_TYPE" && (
                                <span>
                                  {t("deployment.riskAlterType", { col: risk.columnName || "", table: risk.tableName })}
                                </span>
                              )}
                              {risk.type === "NULL_TO_NOT_NULL" && (
                                <span>
                                  {t("deployment.riskNullViolation", {
                                    col: risk.columnName || "",
                                    table: risk.tableName,
                                  })}
                                </span>
                              )}
                            </h4>
                            <Badge tone={risk.severity === "critical" ? "danger" : "warning"}>
                              {risk.affectedRowCount} {t("deployment.rowsAffected")}
                            </Badge>
                          </div>

                          {/* Data Sample Preview */}
                          {risk.sampleData && risk.sampleData.length > 0 && (
                            <div className="rounded-sm border border-border bg-surface-raised p-2 text-[11px]">
                              <span className="mb-1 block font-semibold text-text-muted">
                                {t("deployment.dataSamplePreview")} ({risk.sampleData.length} {t("deployment.items")}):
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {risk.sampleData.map((item, i) => (
                                  <span
                                    key={i}
                                    className="inline-block max-w-[200px] truncate rounded bg-surface px-1.5 py-0.5 font-mono text-text shadow-xs"
                                  >
                                    {typeof item === "object" ? JSON.stringify(item) : String(item)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Strategy selector radio group */}
                          <div className="space-y-1.5 pt-1">
                            <span className="block font-semibold text-text">{t("deployment.selectStrategy")}:</span>
                            <div className="space-y-1">
                              {risk.availableStrategies.map((opt) => {
                                const selected = currentRes?.strategy === opt.key;
                                return (
                                  <label
                                    key={opt.key}
                                    className={`flex cursor-pointer items-center justify-between rounded-sm border p-2 text-xs transition-colors ${
                                      selected
                                        ? "border-accent bg-accent/10 font-medium text-accent"
                                        : "border-border bg-surface text-text hover:bg-surface-hover"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name={risk.id}
                                        checked={selected}
                                        onChange={() => handleStrategyChange(risk, opt.key)}
                                        className="text-accent"
                                      />
                                      <span>{t(opt.labelKey as TranslationKeyOf)}</span>
                                    </div>
                                    <span className="text-[10px] text-text-muted">
                                      {t(opt.descriptionKey as TranslationKeyOf)}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>

                            {/* Optional default value input if strategy requires it */}
                            {currentRes?.strategy === "BACKFILL_DEFAULT" && (
                              <div className="pt-1.5">
                                <label className="mb-1 block text-[11px] font-medium text-text">
                                  {t("deployment.enterDefaultValue")}
                                </label>
                                <input
                                  className={INPUT_CLASS}
                                  value={currentRes.value ?? ""}
                                  onChange={(e) => handleStrategyChange(risk, "BACKFILL_DEFAULT", e.target.value)}
                                  placeholder="ex: 'default_value' or 0"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 3: SQL Preview */}
        {activeStep === "sql" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted">{t("deployment.generatedSqlScript")}</span>
              <Button size="xs" variant="ghost" onClick={handleCopySql}>
                {copied ? t("common.copied") : t("common.copy")}
              </Button>
            </div>
            <textarea
              readOnly
              className={`${TEXTAREA_CODE_CLASS} h-72 w-full`}
              value={plan?.sqlPreview ?? "-- No SQL generated"}
            />
          </div>
        )}

        {/* Step 4: Done result */}
        {activeStep === "done" && deployResult && (
          <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-xs">
            <CheckCircleIcon size={32} className="mx-auto mb-2 text-emerald-400" />
            <h3 className="text-base font-bold text-text">{t("deployment.deploySuccessTitle")}</h3>
            <p className="mt-1 text-text-muted">
              {t("deployment.deploySuccessDesc", {
                count: deployResult.executedStatements,
                name: selectedConn?.name || "",
              })}
            </p>
            {deployResult.irreversibleWarnings.length > 0 && (
              <div className="mt-3 space-y-1 rounded-sm border border-amber-500/40 bg-amber-500/5 p-2.5 text-left text-[11px] text-amber-300">
                <p className="font-semibold">{t("deployment.rollbackIrreversibleTitle")}</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {deployResult.irreversibleWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Deployment history for this connection, with rollback */}
        {activeStep === "history" && selectedConnId && (
          <DeploymentHistoryPanel projectId={props.projectId} connId={selectedConnId} engine={selectedConn?.engine} />
        )}

        {error && <ErrorText>{error}</ErrorText>}

        {/* Modal footer actions */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2">
            {activeStep === "risks" && (
              <Button size="sm" variant="ghost" onClick={() => setActiveStep("diff")}>
                {t("common.back")}
              </Button>
            )}
            {activeStep === "sql" && (
              <Button size="sm" variant="ghost" onClick={() => setActiveStep(risks.length > 0 ? "risks" : "diff")}>
                {t("common.back")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={props.onClose}>
              {t("common.close")}
            </Button>

            {activeStep === "diff" && diff?.hasChanges && (
              <Button size="sm" variant="primary" onClick={() => setActiveStep(risks.length > 0 ? "risks" : "sql")}>
                {risks.length > 0 ? t("deployment.reviewRisks") : t("deployment.previewSql")}
              </Button>
            )}

            {activeStep === "risks" && (
              <Button size="sm" variant="primary" onClick={() => setActiveStep("sql")}>
                {t("deployment.previewSql")}
              </Button>
            )}

            {activeStep === "sql" && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleApplyDeployment}
                disabled={deploying || !diff?.hasChanges}
              >
                <CheckIcon size={13} /> {deploying ? t("deployment.deploying") : t("deployment.applyMigration")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
