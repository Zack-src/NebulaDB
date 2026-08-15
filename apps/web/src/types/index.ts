import type { TableNodeType } from "@/features/editor/nodes/TableNode";
import type { ZoneNodeType } from "@/features/editor/nodes/ZoneNode";
import type { StickyNoteNodeType } from "@/features/editor/nodes/StickyNoteNode";
import type { EnumNodeType } from "@/features/editor/nodes/EnumNode";
import type { TableGroupNodeType } from "@/features/editor/nodes/TableGroupNode";

/** Re-exported so components can type a lookup table of dictionary keys without reaching into i18n internals. */
export type { TranslationKey as TranslationKeyOf } from "@/i18n/translate";

export type CanvasNode = TableNodeType | ZoneNodeType | StickyNoteNodeType | EnumNodeType | TableGroupNodeType;
/**
 * Historically `CanvasNode | CursorNodeType` — remote cursors moved out of
 * React Flow's `nodes` array into a `ViewportPortal` overlay (see
 * `RemoteCursorsLayer`) so a peer's mouse movement no longer forces React
 * Flow to re-diff every node on the canvas. Kept as an alias, not inlined,
 * so the node-change handler's intent ("this is React Flow's nodes-prop
 * change type") still reads clearly at the call site.
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

/**
 * Canvas snapshot formats. Text formats (DBML, SQL dialects, anything a plugin
 * adds) are no longer an enum here — they come from exporter contributions at
 * runtime; see `plugins/types.ts`.
 */
export type ImageFormat = "png" | "svg" | "pdf";

export interface CanvasImageCapture {
  dataUrl: string;
  width: number;
  height: number;
}

export interface CanvasExportHandle {
  capture: (format: "png" | "svg") => Promise<CanvasImageCapture>;
}
