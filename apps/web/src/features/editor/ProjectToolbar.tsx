import { PresenceList } from "@/features/collaboration/PresenceList";
import type { AwarenessState, ConnectionStatus } from "@/features/collaboration/yjsClient";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { Badge } from "@/components/ui/Badge";
import {
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

  const panelActions = [
    { icon: <UploadIcon size={13} />, labelKey: "editor.import", onClick: props.onShowImport },
    { icon: <DownloadIcon size={13} />, labelKey: "editor.export", onClick: props.onShowExport },
    { icon: <ClockIcon size={13} />, labelKey: "editor.history", onClick: props.onShowHistory },
    { icon: <PuzzleIcon size={13} />, labelKey: "editor.plugins", onClick: props.onShowPlugins },
  ] as const;

  return (
    <header className="h-14 shrink-0 px-4 border-b border-border/80 bg-surface/90 glass-panel flex items-center justify-between select-none z-30">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={props.onBack}
          data-tooltip={t("admin.backToProjects")}
          data-tooltip-pos="bottom"
        >
          <ChevronLeftIcon size={16} />
        </Button>
        <div className="flex items-center gap-2 cursor-pointer" onClick={props.onBack}>
          <BrandMark size={24} iconSize={13} />
          <span className="text-sm font-bold tracking-tight text-text">{props.projectName}</span>
          {props.viewOnly && (
            <Badge tone="muted" className="ml-1">
              {t("projects.card.readOnly")}
            </Badge>
          )}
        </div>

        <span className="w-px h-4 bg-border/60 mx-1" />

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onUndo}
            data-tooltip={t("editor.undo")}
            data-tooltip-pos="bottom"
          >
            <UndoIcon size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onRedo}
            data-tooltip={t("editor.redo")}
            data-tooltip-pos="bottom"
          >
            <RedoIcon size={14} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={props.onAutoLayout}
            data-tooltip={t("editor.autoLayout")}
            data-tooltip-pos="bottom"
          >
            <LayoutGridIcon size={14} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-surface-raised/60 p-1 rounded-lg border border-border/50">
          {panelActions.map((action) => (
            <Button key={action.labelKey} size="sm" variant="ghost" onClick={action.onClick} className="text-xs">
              {action.icon} {t(action.labelKey)}
            </Button>
          ))}
        </div>

        <span className="w-px h-4 bg-border/60 mx-1" />

        <ConnectionIndicator connection={props.connection} synced={props.synced} />

        <PresenceList localName={props.localUser} localColor={props.localColor} remote={props.remoteAwareness} />

        <div className="flex items-center gap-2 pl-2">
          {props.onOpenSettings && (
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onOpenSettings}
              data-tooltip={t("common.settings")}
              data-tooltip-pos="bottom"
            >
              <SettingsIcon size={15} />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
