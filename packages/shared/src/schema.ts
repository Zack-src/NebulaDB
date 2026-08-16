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

export interface Ref {
  id: Id;
  name?: string;
  from: RefEndpoint;
  to: RefEndpoint;
  cardinality: RefCardinality;
  routingPoints?: RoutingPoint[];
  style?: VisualStyle;
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

export type DatabaseEngine = "postgres" | "mysql" | "sqlite";

export interface DatabaseConnectionConfig {
  id: string;
  projectId: string;
  name: string;
  engine: DatabaseEngine;
  /** Free-text operator label ("production", "staging", a client name) — never interpreted by the app, only shown and recorded on `DeploymentHistoryEntry` so history still reads correctly after the connection is later renamed or deleted. */
  environment?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  connectionString?: string;
  filePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatabaseConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  engine: DatabaseEngine;
  environment?: string;
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
  | "UNIQUE_VIOLATION";

export type ConflictResolutionStrategy =
  | "DROP_DATA_CONFIRMED"
  | "KEEP_IN_DB"
  | "FORCE_CAST"
  | "CLEAR_COLUMN_DATA"
  | "BACKFILL_DEFAULT"
  | "DELETE_OFFENDING_ROWS"
  | "CANCEL";

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
}

export type MigrationResolutionMap = Record<string, { strategy: ConflictResolutionStrategy; value?: string }>;
