export type Id = string;

export type DetailLevel = "compact" | "standard" | "full";

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface VisualStyle {
  color?: string;
  borderColor?: string;
}

export interface Field {
  id: Id;
  name: string;
  type: string;
  pk?: boolean;
  unique?: boolean;
  notNull?: boolean;
  increment?: boolean;
  default?: string;
  /**
   * What `default` is, as DBML spells it: `` `now()` `` (expression), `'x'`
   * (string), `3` (number), `true`/`null` (boolean). Without it `default` is
   * a bare string and "is `now()` a function call or the text now()?" can only
   * be guessed — which the DBML round trip used to get wrong (an expression
   * came back as the string `'now()'`). Unset on older data and on values
   * typed without backticks in the field editor: those keep the guess.
   */
  defaultKind?: "expression" | "string" | "number" | "boolean";
  note?: string;
}

export interface TableIndex {
  id: Id;
  fieldIds: Id[];
  unique?: boolean;
  /** Composite primary key — DBML/SQL only represent a 2+ column PK as an index, never as multiple per-field `pk` flags. */
  pk?: boolean;
  name?: string;
}

export interface Table {
  id: Id;
  name: string;
  schemaName?: string;
  note?: string;
  fields: Field[];
  indexes: TableIndex[];
  position: Position;
  size?: Size;
  style?: VisualStyle;
  detailLevel: DetailLevel;
  comments?: Comment[];
}

/**
 * Detail level a genuinely new table should start at: whatever level every
 * existing table currently shares, or "standard" for the first table / once
 * tables have already diverged. A hardcoded "standard" here breaks that
 * uniformity the moment the project is set to "compact" or "full" — the
 * toolbar's active-level check (every table must share one level to light up
 * a button) then has no majority to report and falls back to a "no level
 * selected" placeholder state instead of showing a real level.
 */
export function defaultDetailLevelForNewTable(existingTables: Table[]): DetailLevel {
  const [first, ...rest] = existingTables;
  if (!first) return "standard";
  return rest.every((t) => t.detailLevel === first.detailLevel) ? first.detailLevel : "standard";
}

export interface Comment {
  id: Id;
  author: string;
  text: string;
  createdAt: string;
  /** Present -> comment on that field; absent -> comment on the table itself. */
  fieldId?: Id;
}

export type RefCardinality = "one-to-one" | "one-to-many" | "many-to-many";

export interface RefEndpoint {
  tableId: Id;
  fieldId: Id;
}

export interface RoutingPoint {
  x: number;
  y: number;
}

/** Standard SQL/DBML referential actions — `[delete: cascade]`/`[update: cascade]` and siblings. */
export type RefAction = "cascade" | "restrict" | "set null" | "set default" | "no action";

export interface Ref {
  id: Id;
  name?: string;
  from: RefEndpoint;
  to: RefEndpoint;
  cardinality: RefCardinality;
  routingPoints?: RoutingPoint[];
  style?: VisualStyle;
  /** `ON DELETE`/`ON UPDATE` behavior for this FK — unset means the database's own default (typically `NO ACTION`). */
  onDelete?: RefAction;
  onUpdate?: RefAction;
}

export interface EnumValue {
  id: Id;
  name: string;
  note?: string;
}

export interface EnumDef {
  id: Id;
  name: string;
  values: EnumValue[];
  /** Canvas position — DBML has no notion of it (like zones/sticky notes), assigned/preserved on import same as a table's. */
  position: Position;
}

export interface Zone {
  id: Id;
  label: string;
  position: Position;
  size: Size;
  style?: VisualStyle;
}

export interface StickyNote {
  id: Id;
  text: string;
  position: Position;
  size: Size;
  style?: VisualStyle;
}

/**
 * A named grouping of existing tables (DBML `TableGroup name { t1 t2 }`) —
 * unlike a `Zone`, membership is a list of table ids, not a spatial area, so
 * there's no position/size of its own to store: the canvas derives one from
 * wherever its member tables currently are.
 */
export interface TableGroup {
  id: Id;
  name: string;
  tableIds: Id[];
  note?: string;
}

export interface Project {
  id: Id;
  name: string;
  tables: Table[];
  refs: Ref[];
  enums: EnumDef[];
  zones: Zone[];
  stickyNotes: StickyNote[];
  tableGroups: TableGroup[];
  /** Custom preset swatch grid for this project's color pickers. Unset -> caller falls back to a built-in default palette. */
  paletteColors?: string[];
}

import type { StructurePolicySetting } from "./dbAdmin.js";
import type { EnvironmentColor } from "./environments.js";

export type DatabaseEngine = "postgres" | "mysql" | "sqlite" | "mssql" | "oracle";

export interface DatabaseConnectionConfig {
  id: string;
  projectId: string;
  name: string;
  engine: DatabaseEngine;
  /**
   * The name of the deployment stage this connection belongs to (see
   * `EnvironmentStage`) — kept in step with the stage, and copied onto each
   * `DeploymentHistoryEntry` so history still reads correctly after a rename.
   * On input, a name is resolved to an existing stage; `environmentId` wins
   * when both are sent.
   */
  environment?: string;
  /** The stage itself; `null` for none. */
  environmentId?: string | null;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  connectionString?: string;
  filePath?: string;
  /** Free-text labels an admin filters the global connection list by. */
  tags?: string[];
  /** When set, the app refuses to write through this connection: no deployment, no write SQL, no drop, no user management. */
  readOnly?: boolean;
  /**
   * This connection's own structure policy; `null` to follow the instance
   * default. Only ever set from the admin console — a project route ignores it.
   */
  structurePolicy?: StructurePolicySetting | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatabaseConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  engine: DatabaseEngine;
  /** The stage's name, its id, colour, and whether it is the production stage — absent when the connection has none. */
  environment?: string;
  environmentId?: string;
  environmentColor?: EnvironmentColor;
  production?: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  hasPassword?: boolean;
  ssl?: boolean;
  connectionString?: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
}

/** `admin`: created in the admin console, lives until an admin deletes it. `project`: created through a project, deleted with its last project. */
export type ConnectionOrigin = "admin" | "project";

export interface ConnectionHealth {
  /** `null` until the first check. */
  status: "online" | "offline" | null;
  checkedAt: string | null;
  version: string | null;
  latencyMs: number | null;
  error: string | null;
}

/** A connection as the admin console lists it: the summary plus what only the global view knows. */
export interface AdminConnectionSummary extends DatabaseConnectionSummary {
  origin: ConnectionOrigin;
  tags: string[];
  readOnly: boolean;
  /** `null`: follows the instance default. */
  structurePolicy: StructurePolicySetting | null;
  projects: { id: string; name: string }[];
  health: ConnectionHealth;
}

/**
 * One past deployment (or rollback of one) against a connection — the record
 * `apply-deployment` and `rollback` leave behind so "what actually ran
 * against production, and when" survives the connection being renamed or
 * even deleted (`connectionName`/`environment` are a snapshot at the time,
 * not a live join).
 */
export interface DeploymentHistoryEntry {
  id: string;
  projectId: string;
  connectionId: string | null;
  connectionName: string;
  environment?: string;
  engine: DatabaseEngine;
  sql: string;
  /** Best-effort inverse SQL generated at deployment time, or null if this entry is itself a rollback (rolling back a rollback isn't offered). */
  rollbackSql: string | null;
  /** Set when this entry *is* a rollback — the id of the deployment it reversed. */
  rollbackOf: string | null;
  success: boolean;
  executedStatements: number;
  totalStatements: number;
  error?: string;
  executedByEmail: string | null;
  createdAt: string;
  /** True once a successful rollback of this entry exists — the rollback action is offered at most once. */
  rolledBack: boolean;
}

export type SchemaDiffRiskType =
  | "DROP_TABLE_WITH_DATA"
  | "DROP_COLUMN_WITH_DATA"
  | "ALTER_COLUMN_TYPE"
  | "NULL_TO_NOT_NULL"
  | "ADD_NOT_NULL_NO_DEFAULT"
  | "FK_VIOLATION"
  | "UNIQUE_VIOLATION"
  /** A column's DBML type isn't the target engine's native spelling — see `translateType` in `typeMapping.ts`. */
  | "TYPE_TRANSLATION_SUGGESTED";

export type ConflictResolutionStrategy =
  | "DROP_DATA_CONFIRMED"
  | "KEEP_IN_DB"
  | "FORCE_CAST"
  | "CLEAR_COLUMN_DATA"
  | "BACKFILL_DEFAULT"
  | "DELETE_OFFENDING_ROWS"
  | "CANCEL"
  /** Apply the engine-native type suggested for a `TYPE_TRANSLATION_SUGGESTED` risk. */
  | "USE_TRANSLATED_TYPE"
  /** Deploy/export the column type exactly as written in the canvas, skipping the suggested translation. */
  | "KEEP_AS_WRITTEN";

export interface StrategyOption {
  key: ConflictResolutionStrategy;
  labelKey: string;
  descriptionKey: string;
  requiresInput?: "default_value";
}

export interface SchemaRisk {
  id: string;
  type: SchemaDiffRiskType;
  severity: "critical" | "warning" | "info";
  tableName: string;
  columnName?: string;
  refName?: string;
  affectedRowCount: number;
  sampleData?: Array<Record<string, unknown> | string | number | boolean | null>;
  availableStrategies: StrategyOption[];
  defaultStrategy: ConflictResolutionStrategy;
  selectedStrategy: ConflictResolutionStrategy;
  userProvidedValue?: string;
  /** For `TYPE_TRANSLATION_SUGGESTED`: the engine-native type suggested in place of what was written. */
  suggestedValue?: string;
}

export type MigrationResolutionMap = Record<string, { strategy: ConflictResolutionStrategy; value?: string }>;
