import type {
  EnumNodeType,
  StickyNoteNodeType,
  TableGroupNodeType,
  TableNodeType,
  ZoneNodeType,
} from "@/features/editor/nodes/nodeTypes";

/** Re-exported so components can type a lookup table of dictionary keys without reaching into i18n internals. */
export type { TranslationKey as TranslationKeyOf } from "@/i18n/translate";

export type CanvasNode = TableNodeType | ZoneNodeType | StickyNoteNodeType | EnumNodeType | TableGroupNodeType;
/**
 * Historically `CanvasNode | CursorNodeType` — remote cursors moved out of
 * the flow's `nodes` array into a `ViewportPortal` overlay (see
 * `RemoteCursorsLayer`) so a peer's mouse movement no longer forces the flow
 * to re-diff every node on the canvas. Kept as an alias, not inlined, so the
 * intent ("this is the flow's nodes array") still reads clearly at the call
 * site.
 */
export type AllNodes = CanvasNode;

export type ProjectStatus = "active" | "archived" | "trashed";
export type PermissionLevel = "view" | "edit" | "administrator";

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  created_at: string;
  permission: PermissionLevel;
}

export interface Session {
  id: string;
  email: string;
  isAdmin: boolean;
  displayName: string;
}

export interface UserSummary {
  id: string;
  email: string;
  isAdmin: boolean;
  displayName: string;
  createdAt: string;
  /** ISO timestamp when the account was disabled; null/absent for an active one. */
  disabledAt?: string | null;
}

/** One of the caller's own login sessions, as returned by `GET /api/auth/sessions`. */
export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

/** One row of the admin audit trail (`GET /api/audit`). */
export interface AuditEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
}

/** One row of the admin error log (`GET /api/errors`). */
export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: "server" | "client";
  message: string;
  stack: string | null;
  context: string | null;
  userId: string | null;
  userEmail: string | null;
}

export interface InvitationSummary {
  token: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "expired";
}

export interface TeamSummary {
  id: string;
  name: string;
  createdAt?: string;
  memberCount: number;
}

export interface TeamDetail {
  id: string;
  name: string;
  createdAt: string;
  members: UserSummary[];
}

export interface ProjectTeamGrant {
  teamId: string;
  teamName: string;
  permission: PermissionLevel;
}

export interface CanvasImageCapture {
  dataUrl: string;
  width: number;
  height: number;
}

export interface CanvasExportHandle {
  capture: (format: "png" | "svg") => Promise<CanvasImageCapture>;
}

export interface CanvasNavigateHandle {
  /** Pans/zooms to the given table (by id) and selects it, same as clicking it directly. False if no such node is on the canvas (yet). */
  goToTable: (tableId: string) => boolean;
}
