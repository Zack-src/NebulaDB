/**
 * Starter schemas offered when creating a project. A template is plain DBML
 * plus a hand-placed layout; `projectTemplateSource` folds that layout into
 * the same `// nebuladb:visual` sidecar an export carries, so seeding a project
 * goes through the ordinary import (`POST /api/projects/:id/import`).
 *
 * Names and descriptions are UI copy: they live in the locale files, keyed by
 * `projects.templates.<id>.*`.
 */

export type ProjectTemplateId = "example" | "blog" | "ecommerce" | "saas";

export interface ProjectTemplate {
  id: ProjectTemplateId;
  dbml: string;
  /** Grid slot (column, row) per table name. */
  layout: Record<string, [number, number]>;
}

const COL_WIDTH = 340;
const ROW_HEIGHT = 320;
const VISUAL_MARKER = "// nebuladb:visual ";

/** The documented example: notes on tables and columns fill the dictionary, so every tab has something to show. */
const EXAMPLE: ProjectTemplate = {
  id: "example",
  dbml: `Table authors {
  id integer [pk, increment]
  name varchar(150) [not null, note: 'Name as printed on the cover.']
  born_on date

  Note: 'People who write books. One row per person, not per pen name.'
}

Table books {
  id integer [pk, increment]
  author_id integer [not null, ref: > authors.id]
  isbn char(13) [not null, unique, note: 'ISBN-13 without dashes.']
  title varchar(250) [not null]
  price_cents integer [not null, note: 'Tax included, in cents.']
  stock integer [not null, default: 0]

  Note: 'The catalogue. A book is a title, not a physical copy.'
}

Table customers {
  id integer [pk, increment]
  email varchar(255) [not null, unique]
  full_name varchar(200) [not null]
  created_at timestamp [not null, default: \`now()\`]

  Note: 'People who ordered at least once.'
}

Table orders {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  status order_status [not null, default: 'pending']
  placed_at timestamp [not null, default: \`now()\`]

  Note: 'One purchase. Its lines are in order_lines.'
}

Table order_lines {
  order_id integer [ref: > orders.id]
  book_id integer [ref: > books.id]
  quantity integer [not null, default: 1]
  unit_price_cents integer [not null, note: 'Price at the time of the order, kept even if the catalogue changes.']

  indexes {
    (order_id, book_id) [pk]
  }

  Note: 'One book on one order, with the quantity and the price paid.'
}

Enum order_status {
  pending
  paid
  shipped
  cancelled
}
`,
  layout: { authors: [0, 0], books: [1, 0], order_lines: [2, 0], orders: [2, 1], customers: [1, 1] },
};

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

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [EXAMPLE, BLOG, ECOMMERCE, SAAS];

export function getProjectTemplate(id: ProjectTemplateId): ProjectTemplate {
  return PROJECT_TEMPLATES.find((template) => template.id === id)!;
}

/** The template's DBML with its layout folded in as a visual-metadata sidecar, ready for the import. */
export function projectTemplateSource(id: ProjectTemplateId): string {
  const template = getProjectTemplate(id);
  const tables: Record<string, { position: { x: number; y: number } }> = {};
  for (const [name, [col, row]] of Object.entries(template.layout)) {
    tables[name] = { position: { x: col * COL_WIDTH, y: row * ROW_HEIGHT } };
  }
  return `${template.dbml}${VISUAL_MARKER}${JSON.stringify({ tables })}\n`;
}
