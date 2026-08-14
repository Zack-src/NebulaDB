import { PresenceList } from "@/features/collaboration/PresenceList";
import type { AwarenessState, ConnectionStatus } from "@/features/collaboration/yjsClient";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { Badge } from "@/components/ui/Badge";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ClockIcon,
  DownloadIcon,
  LayoutGridIcon,
  PuzzleIcon,
  RedoIcon,
  SettingsIcon,
  UndoIcon,
  UploadIcon,
} from "@/components/icons/Icons";
import { useTranslation } from "@/i18n/useTranslation";

export interface ProjectToolbarProps {
  projectName: string;
  viewOnly: boolean;
  connection: ConnectionStatus;
  /** False until the first sync lands, even when the socket itself is already open. */
  synced: boolean;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onShowImport: () => void;
  onShowExport: () => void;
  onShowHistory: () => void;
  onShowPlugins: () => void;
  onShowValidation: () => void;
  onOpenSettings?: () => void;
  validationCount: number;
  hasValidationErrors: boolean;
  localUser: string;
  localColor: string;
  remoteAwareness: Map<number, AwarenessState>;
}

const DIVIDER_CLASS = "mx-1 h-5 w-px shrink-0 bg-border";

/**
 * Live-sync state, shown only when it isn't the boring one: a dropped socket
 * has to be visible, since edits made while it's down reach nobody else until
 * the reconnect lands.
 */
function ConnectionIndicator({ connection, synced }: { connection: ConnectionStatus; synced: boolean }) {
  const { t } = useTranslation();
  if (connection === "connected" && synced) return null;
  const reconnecting = connection === "reconnecting" || connection === "closed";

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
      <span
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
          reconnecting ? "bg-danger shadow-[0_0_0_3px_var(--color-danger-light)]" : "bg-text-muted"
        }`}
      />
      {t(reconnecting ? "editor.reconnecting" : "editor.connecting")}
    </span>
  );
}

/**
 * Schema-check status. This used to be missing entirely: `ProjectEditor` passed
 * `onShowValidation`/`validationCount`/`hasValidationErrors` down and the
 * toolbar rendered none of them, which left the validation panel with no way to
 * be opened at all.
 */
function ValidationButton(props: { count: number; hasErrors: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const clean = props.count === 0;

  return (
    <Button
      size="sm"
      variant={props.hasErrors ? "danger" : "ghost"}
      onClick={props.onClick}
      data-tooltip={t("validation.title")}
      data-tooltip-pos="bottom"
      className={!props.hasErrors && !clean ? "text-warning" : ""}
    >
      {clean ? <CheckCircleIcon size={14} /> : <AlertTriangleIcon size={14} />}
      <span className="hidden tabular-nums lg:inline">{clean ? t("validation.ok") : props.count}</span>
    </Button>
  );
}

export function ProjectToolbar(props: ProjectToolbarProps) {
  const { t } = useTranslation();

  const panelActions = [
    { icon: <UploadIcon size={14} />, labelKey: "editor.import", onClick: props.onShowImport },
    { icon: <DownloadIcon size={14} />, labelKey: "editor.export", onClick: props.onShowExport },
    { icon: <ClockIcon size={14} />, labelKey: "editor.history", onClick: props.onShowHistory },
    { icon: <PuzzleIcon size={14} />, labelKey: "editor.plugins", onClick: props.onShowPlugins },
  ] as const;

  const historyActions = [
    { icon: <UndoIcon size={14} />, labelKey: "editor.undo", onClick: props.onUndo },
    { icon: <RedoIcon size={14} />, labelKey: "editor.redo", onClick: props.onRedo },
    { icon: <LayoutGridIcon size={14} />, labelKey: "editor.autoLayout", onClick: props.onAutoLayout },
  ] as const;

  return (
    <header className="z-30 flex h-14 shrink-0 select-none items-center justify-between gap-3 border-b border-border bg-surface/90 px-3 glass-panel">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={props.onBack}
          data-tooltip={t("admin.backToProjects")}
          data-tooltip-pos="bottom"
          aria-label={t("admin.backToProjects")}
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <div className="flex min-w-0 items-center gap-2 pl-1 pr-2">
          <BrandMark size={24} iconSize={13} />
          <span className="truncate text-sm font-bold tracking-tight text-text">{props.projectName}</span>
          {props.viewOnly && <Badge tone="muted">{t("projects.card.readOnly")}</Badge>}
        </div>

        <span className={DIVIDER_CLASS} />

        <div className="flex items-center gap-0.5">
          {historyActions.map((action) => (
            <Button
              key={action.labelKey}
              size="icon-sm"
              variant="ghost"
              onClick={action.onClick}
              data-tooltip={t(action.labelKey)}
              data-tooltip-pos="bottom"
              aria-label={t(action.labelKey)}
            >
              {action.icon}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center gap-0.5 md:flex">
          {panelActions.map((action) => (
            <Button key={action.labelKey} size="sm" variant="ghost" onClick={action.onClick}>
              {action.icon} <span className="hidden lg:inline">{t(action.labelKey)}</span>
            </Button>
          ))}
        </div>

        <ValidationButton
          count={props.validationCount}
          hasErrors={props.hasValidationErrors}
          onClick={props.onShowValidation}
        />

        <span className={DIVIDER_CLASS} />

        <ConnectionIndicator connection={props.connection} synced={props.synced} />

        <PresenceList localName={props.localUser} localColor={props.localColor} remote={props.remoteAwareness} />

        {props.onOpenSettings && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={props.onOpenSettings}
            data-tooltip={t("common.settings")}
            data-tooltip-pos="bottom"
            aria-label={t("common.settings")}
          >
            <SettingsIcon size={15} />
          </Button>
        )}
      </div>
    </header>
  );
}
