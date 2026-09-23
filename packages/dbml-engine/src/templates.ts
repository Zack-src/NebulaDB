import type { Position, Project } from "@athanordb/shared";
import { mergeProjectIntoExisting, parseDbml, toProject } from "./dbml.js";
import { applyVisualMetadata } from "./serialize.js";

/**
 * Starter schemas offered when creating a project. A template is plain DBML
 * plus a hand-placed layout; `projectTemplateSource` folds that layout into
 * the same `// athanordb:visual` sidecar an export with visual metadata
 * carries, so seeding a project goes through the ordinary import path
 * (`toProject` + `applyVisualMetadata`) rather than a parallel one.
 *
 * Names/descriptions are deliberately not stored here — they are UI copy and
 * live in the web app's locale files, keyed by `projects.templates.<id>.*`.
 */

export type ProjectTemplateId = "blog" | "ecommerce" | "saas" | "auth";

export interface ProjectTemplate {
  id: ProjectTemplateId;
  dbml: string;
  /** Grid slot (column, row) per table name — converted to canvas coordinates below. */
  layout: Record<string, [number, number]>;
}

const COL_WIDTH = 340;
const ROW_HEIGHT = 320;

const BLOG: ProjectTemplate = {
  id: "blog",
  dbml: `Table users {
  id integer [pk, increment]
  username varchar(50) [not null, unique]
  email varchar(255) [not null, unique]
  created_at timestamp [not null, default: \`now()\`]
}

Table posts {
  id integer [pk, increment]
  author_id integer [not null, ref: > users.id]
  title varchar(200) [not null]
  slug varchar(200) [not null, unique]
  body text
  status post_status [not null, default: 'draft']
  published_at timestamp
  created_at timestamp [not null, default: \`now()\`]
}

Table comments {
  id integer [pk, increment]
  post_id integer [not null, ref: > posts.id]
  author_id integer [ref: > users.id]
  body text [not null]
  created_at timestamp [not null, default: \`now()\`]
}

Table tags {
  id integer [pk, increment]
  name varchar(50) [not null, unique]
}

Table post_tags {
  post_id integer [ref: > posts.id]
  tag_id integer [ref: > tags.id]

  indexes {
    (post_id, tag_id) [pk]
  }
}

Enum post_status {
  draft
  published
  archived
}
`,
  layout: { users: [0, 0], posts: [1, 0], comments: [2, 0], post_tags: [1, 1], tags: [2, 1] },
};

const ECOMMERCE: ProjectTemplate = {
  id: "ecommerce",
  dbml: `Table customers {
  id integer [pk, increment]
  email varchar(255) [not null, unique]
  full_name varchar(200) [not null]
  created_at timestamp [not null, default: \`now()\`]
}

Table addresses {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  line1 varchar(255) [not null]
  city varchar(100) [not null]
  postal_code varchar(20) [not null]
  country char(2) [not null]
}

Table categories {
  id integer [pk, increment]
  parent_id integer [ref: > categories.id]
  name varchar(100) [not null]
}

Table products {
  id integer [pk, increment]
  category_id integer [ref: > categories.id]
  sku varchar(64) [not null, unique]
  name varchar(200) [not null]
  price_cents integer [not null]
  stock integer [not null, default: 0]
}

Table orders {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  shipping_address_id integer [ref: > addresses.id]
  status order_status [not null, default: 'pending']
  total_cents integer [not null]
  created_at timestamp [not null, default: \`now()\`]
}

Table order_items {
  order_id integer [ref: > orders.id]
  product_id integer [ref: > products.id]
  quantity integer [not null]
  unit_price_cents integer [not null]

  indexes {
    (order_id, product_id) [pk]
  }
}

Enum order_status {
  pending
  paid
  shipped
  delivered
  cancelled
}
`,
  layout: {
    customers: [0, 0],
    addresses: [0, 1],
    orders: [1, 0],
    order_items: [2, 0],
    products: [3, 0],
    categories: [3, 1],
  },
};

const SAAS: ProjectTemplate = {
  id: "saas",
  dbml: `Table organizations {
  id uuid [pk]
  name varchar(200) [not null]
  plan plan_tier [not null, default: 'free']
  created_at timestamp [not null, default: \`now()\`]
}

Table users {
  id uuid [pk]
  email varchar(255) [not null, unique]
  display_name varchar(100)
  created_at timestamp [not null, default: \`now()\`]
}

Table memberships {
  organization_id uuid [ref: > organizations.id]
  user_id uuid [ref: > users.id]
  role member_role [not null, default: 'member']

  indexes {
    (organization_id, user_id) [pk]
  }
}

Table subscriptions {
  id uuid [pk]
  organization_id uuid [not null, unique, ref: - organizations.id]
  status varchar(20) [not null]
  current_period_end timestamp
}

Table invoices {
  id uuid [pk]
  organization_id uuid [not null, ref: > organizations.id]
  amount_cents integer [not null]
  issued_at timestamp [not null]
  paid_at timestamp
}

Table audit_events {
  id bigint [pk, increment]
  organization_id uuid [not null, ref: > organizations.id]
  actor_id uuid [ref: > users.id]
  action varchar(100) [not null]
  created_at timestamp [not null, default: \`now()\`]
}

Enum plan_tier {
  free
  pro
  enterprise
}

Enum member_role {
  owner
  admin
  member
}
`,
  layout: {
    users: [0, 0],
    memberships: [1, 0],
    organizations: [2, 0],
    subscriptions: [3, 0],
    invoices: [3, 1],
    audit_events: [1, 1],
  },
};

const AUTH: ProjectTemplate = {
  id: "auth",
  dbml: `Table users {
  id uuid [pk]
  email varchar(255) [not null, unique]
  password_hash varchar(255) [not null]
  email_verified_at timestamp
  disabled boolean [not null, default: false]
  created_at timestamp [not null, default: \`now()\`]
}

Table sessions {
  id varchar(64) [pk]
  user_id uuid [not null, ref: > users.id]
  expires_at timestamp [not null]
  created_at timestamp [not null, default: \`now()\`]
}

Table roles {
  id integer [pk, increment]
  name varchar(50) [not null, unique]
}

Table user_roles {
  user_id uuid [ref: > users.id]
  role_id integer [ref: > roles.id]

  indexes {
    (user_id, role_id) [pk]
  }
}

Table password_reset_tokens {
  token varchar(64) [pk]
  user_id uuid [not null, ref: > users.id]
  expires_at timestamp [not null]
  used_at timestamp
}
`,
  layout: { users: [0, 0], sessions: [1, 0], user_roles: [1, 1], roles: [2, 1], password_reset_tokens: [0, 1] },
};

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [BLOG, ECOMMERCE, SAAS, AUTH];

export function isProjectTemplateId(value: unknown): value is ProjectTemplateId {
  return typeof value === "string" && PROJECT_TEMPLATES.some((template) => template.id === value);
}

export function getProjectTemplate(id: ProjectTemplateId): ProjectTemplate {
  return PROJECT_TEMPLATES.find((template) => template.id === id)!;
}

/**
 * The seeded `Project` for a new project, built exactly the way a DBML import
 * into an empty project is: `toProject`'s ids are only declaration-order
 * counters (unique per parse, not per project — two tables' first fields
 * share one), and it's `mergeProjectIntoExisting` that mints real ids. Writing
 * `toProject`'s output straight into a doc crashes the canvas on duplicate
 * keys.
 */
export function projectFromTemplate(id: ProjectTemplateId, projectId: string, projectName: string): Project {
  const source = projectTemplateSource(id);
  const parsed = applyVisualMetadata(toProject(parseDbml(source), projectName, source), source);
  const empty: Project = {
    id: projectId,
    name: projectName,
    tables: [],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  return mergeProjectIntoExisting(empty, parsed);
}

/** The template's DBML with its layout folded in as a visual-metadata sidecar, ready for the import path. */
export function projectTemplateSource(id: ProjectTemplateId): string {
  const template = getProjectTemplate(id);
  const tables: Record<string, { position: Position }> = {};
  for (const [name, [col, row]] of Object.entries(template.layout)) {
    tables[name] = { position: { x: col * COL_WIDTH, y: row * ROW_HEIGHT } };
  }
  return `${template.dbml}// athanordb:visual ${JSON.stringify({ tables })}\n`;
}
