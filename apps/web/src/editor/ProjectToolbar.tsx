import { PresenceList } from "../PresenceList.js";
import type { AwarenessState, ConnectionStatus } from "../yjsClient.js";
import { Button } from "../ui/Button.js";
import { BrandMark } from "../ui/BrandMark.js";
import { Badge } from "../ui/Badge.js";
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
} from "../Icons.js";

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
  onDisplayNameChange: (name: string) => void;
}

/**
 * Live-sync state, shown only when it isn't the boring one: a dropped socket
 * has to be visible, since edits made while it's down reach nobody else until
 * the reconnect lands.
 */
function ConnectionIndicator({ connection, synced }: { connection: ConnectionStatus; synced: boolean }) {
  if (connection === "connected" && synced) return null;
  const reconnecting = connection === "reconnecting" || connection === "closed";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
      <span
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
          reconnecting ? "bg-danger shadow-[0_0_0_3px_var(--color-danger-light)]" : "bg-text-muted"
        }`}
      />
      {reconnecting ? "reconnecting…" : "connecting…"}
    </span>
  );
}

export function ProjectToolbar(props: ProjectToolbarProps) {
  return (
    <header className="h-14 shrink-0 px-4 border-b border-border/80 bg-surface/90 glass-panel flex items-center justify-between select-none z-30">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={props.onBack} data-tooltip="Retour aux projets" data-tooltip-pos="bottom">
          <ChevronLeftIcon size={16} />
        </Button>
        <div className="flex items-center gap-2 cursor-pointer" onClick={props.onBack}>
          <BrandMark size={24} iconSize={13} />
          <span className="text-sm font-bold tracking-tight text-text">{props.projectName}</span>
          {props.viewOnly && <Badge tone="muted" className="ml-1">Lecture seule</Badge>}
        </div>

        <span className="w-px h-4 bg-border/60 mx-1" />

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={props.onUndo} data-tooltip="Annuler (Ctrl+Z)" data-tooltip-pos="bottom">
            <UndoIcon size={14} />
          </Button>
          <Button size="icon" variant="ghost" onClick={props.onRedo} data-tooltip="Rétablir (Ctrl+Shift+Z)" data-tooltip-pos="bottom">
            <RedoIcon size={14} />
          </Button>
          <Button size="icon" variant="ghost" onClick={props.onAutoLayout} data-tooltip="Réorganiser (Auto-layout)" data-tooltip-pos="bottom">
            <LayoutGridIcon size={14} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-surface-raised/60 p-1 rounded-lg border border-border/50">
          <Button size="sm" variant="ghost" onClick={props.onShowImport} className="text-xs">
            <UploadIcon size={13} /> Importer
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onShowExport} className="text-xs">
            <DownloadIcon size={13} /> Exporter
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onShowHistory} className="text-xs">
            <ClockIcon size={13} /> Historique
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onShowPlugins} className="text-xs">
            <PuzzleIcon size={13} /> Plugins
          </Button>
        </div>

        <span className="w-px h-4 bg-border/60 mx-1" />

        <ConnectionIndicator connection={props.connection} synced={props.synced} />

        <PresenceList localName={props.localUser} localColor={props.localColor} remote={props.remoteAwareness} />

        <div className="flex items-center gap-2 pl-2">
          {props.onOpenSettings && (
            <Button variant="ghost" size="icon" onClick={props.onOpenSettings} data-tooltip="Paramètres" data-tooltip-pos="bottom">
              <SettingsIcon size={15} />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}


