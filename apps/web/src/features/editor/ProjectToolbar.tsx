import { PresenceList } from "@/features/collaboration/PresenceList";
import type { AwarenessState, ConnectionStatus } from "@/features/collaboration/yjsClient";
import { Button } from "@/components/ui/Button";
import { APP_HEADER } from "@/components/ui/layout";
import { BrandMark } from "@/components/ui/BrandMark";
import { Badge } from "@/components/ui/Badge";
import {
  ChevronLeftIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  LayoutGridIcon,
  RedoIcon,
  SettingsIcon,
  SparklesIcon,
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
  onShowConnections?: () => void;
  onShowDeploy?: () => void;
  /**
   * `edit` is enough to change the schema, but a live database connection
   * lets the server reach a network host or local file the caller supplies
   * and, for a deployment, execute arbitrary generated SQL against it — a
   * materially larger blast radius than a canvas edit. The connections
   * routes already enforce project `administrator` server-side (see
   * `apps/server/src/modules/connections/routes.ts`); this hides the two
   * buttons for anyone who'd just get a 403 clicking them, rather than
   * leaving that as the only signal they lack access.
   */
  isProjectAdmin: boolean;
  connectedDbName?: string | null;
  onOpenSettings?: () => void;
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

export function ProjectToolbar(props: ProjectToolbarProps) {
  const { t } = useTranslation();

  // Export and history are reads — a viewer keeps them. Import writes, so it
  // is dropped entirely rather than disabled: a viewer has no path to make it
  // work. Plugins now lives only in the canvas toolbar (it was duplicated
  // here), and the validation check had no button left pointing at it.
  const panelActions = [
    ...(props.viewOnly ? [] : [{ icon: <UploadIcon size={14} />, labelKey: "editor.import", onClick: props.onShowImport } as const]),
    { icon: <DownloadIcon size={14} />, labelKey: "editor.export", onClick: props.onShowExport },
    { icon: <ClockIcon size={14} />, labelKey: "editor.history", onClick: props.onShowHistory },
  ] as const;

  const historyActions = props.viewOnly
    ? []
    : ([
        { icon: <UndoIcon size={14} />, labelKey: "editor.undo", onClick: props.onUndo },
        { icon: <RedoIcon size={14} />, labelKey: "editor.redo", onClick: props.onRedo },
        { icon: <LayoutGridIcon size={14} />, labelKey: "editor.autoLayout", onClick: props.onAutoLayout },
      ] as const);

  return (
    <header className={`${APP_HEADER} justify-between gap-3 !px-3`}>
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
          {props.viewOnly && (
            <span className="shrink-0" data-tooltip={t("editor.viewOnlyHint")} data-tooltip-pos="bottom">
              <Badge tone="muted">{t("projects.card.readOnly")}</Badge>
            </span>
          )}
        </div>

        {historyActions.length > 0 && <span className={DIVIDER_CLASS} />}

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


          {props.onShowConnections && !props.viewOnly && props.isProjectAdmin && (
            <Button size="sm" variant="ghost" onClick={props.onShowConnections}>
              <DatabaseIcon size={14} />{" "}
              <span className="hidden lg:inline">
                {props.connectedDbName ? props.connectedDbName : t("connections.database")}
              </span>
            </Button>
          )}

          {props.onShowDeploy && !props.viewOnly && props.isProjectAdmin && (
            <Button size="sm" variant="primary" onClick={props.onShowDeploy}>
              <SparklesIcon size={13} /> <span className="hidden sm:inline">{t("deployment.deploy")}</span>
            </Button>
          )}
        </div>

        <span className={`${DIVIDER_CLASS} hidden md:block`} />


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
