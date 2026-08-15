import { hoverTooltip } from "@codemirror/view";
import { getSymbols, tableAt, unquoteIdent, type EnumSymbol, type TableSymbol } from "@/features/editor/dbml/symbols";
import { tokenAt } from "@/features/editor/dbml/navigation";

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function tableCard(table: TableSymbol, highlightField?: string): HTMLElement {
  const root = el("div", "cm-dbml-hover");
  const title = el("div", "cm-dbml-hover-title");
  title.append(
    el("span", "cm-dbml-hover-kind", "table"),
    document.createTextNode(" "),
    el("span", "", table.schema ? `${table.schema}.${table.name}` : table.name),
  );
  if (table.alias) title.append(el("span", "cm-dbml-hover-muted", ` as ${table.alias}`));
  root.append(title);
  if (table.note) root.append(el("div", "cm-dbml-hover-note", table.note));

  const list = el("div", "cm-dbml-hover-fields");
  for (const field of table.fields.slice(0, 24)) {
    const row = el(
      "div",
      `cm-dbml-hover-row${highlightField && field.name.toLowerCase() === highlightField.toLowerCase() ? " is-current" : ""}`,
    );
    row.append(el("span", "cm-dbml-hover-name", field.name));
    row.append(el("span", "cm-dbml-hover-type", field.type));
    const flags = [
      field.pk && "pk",
      field.unique && "unique",
      field.notNull && "not null",
      field.increment && "increment",
    ]
      .filter(Boolean)
      .join(", ");
    if (flags) row.append(el("span", "cm-dbml-hover-flag", flags));
    list.append(row);
  }
  if (table.fields.length > 24) list.append(el("div", "cm-dbml-hover-muted", `… ${table.fields.length - 24} more`));
  root.append(list);
  return root;
}

function enumCard(sym: EnumSymbol): HTMLElement {
  const root = el("div", "cm-dbml-hover");
  const title = el("div", "cm-dbml-hover-title");
  title.append(el("span", "cm-dbml-hover-kind", "enum"), document.createTextNode(" "), el("span", "", sym.name));
  root.append(title);
  const list = el("div", "cm-dbml-hover-fields");
  for (const value of sym.values) list.append(el("div", "cm-dbml-hover-row", value.name));
  root.append(list);
  return root;
}

/** Rich hover cards for tables, columns and enums — the editor's "peek definition". */
export const dbmlHover = hoverTooltip(
  (view, pos) => {
    const state = view.state;
    const line = state.doc.lineAt(pos);
    const tok = tokenAt(line.text, pos - line.from);
    if (!tok) return null;
    const symbols = getSymbols(state);
    const name = unquoteIdent(tok.text);
    const before = line.text.slice(0, tok.from).trimEnd();
    const afterChar = line.text.slice(tok.to).trimStart()[0];

    const make = (dom: HTMLElement) => ({
      pos: line.from + tok.from,
      end: line.from + tok.to,
      above: true,
      create: () => ({ dom }),
    });

    // `Table.field`
    if (before.endsWith(".")) {
      const ownerTok = tokenAt(line.text, before.length - 2);
      const owner = ownerTok && symbols.tableByName.get(unquoteIdent(ownerTok.text).toLowerCase());
      if (owner) return make(tableCard(owner, name));
    }
    if (afterChar === ".") {
      const table = symbols.tableByName.get(name.toLowerCase());
      if (table) return make(tableCard(table));
    }

    const enumSym = symbols.enumByName.get(name.toLowerCase());
    if (enumSym) return make(enumCard(enumSym));

    const table = symbols.tableByName.get(name.toLowerCase());
    if (table) return make(tableCard(table));

    // a column inside its own table
    const owner = tableAt(symbols, state.doc, pos);
    const field = owner?.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (owner && field) {
      const root = el("div", "cm-dbml-hover");
      const title = el("div", "cm-dbml-hover-title");
      title.append(
        el("span", "cm-dbml-hover-kind", "column"),
        document.createTextNode(" "),
        el("span", "", `${owner.name}.${field.name}`),
      );
      root.append(title, el("div", "cm-dbml-hover-type", field.type));
      if (field.settings) root.append(el("div", "cm-dbml-hover-muted", `[${field.settings}]`));
      if (field.note) root.append(el("div", "cm-dbml-hover-note", field.note));
      const incoming = symbols.refs.filter(
        (r) =>
          (r.left.table.toLowerCase() === owner.name.toLowerCase() && r.left.fields.includes(field.name)) ||
          (r.right.table.toLowerCase() === owner.name.toLowerCase() && r.right.fields.includes(field.name)),
      );
      for (const ref of incoming) {
        root.append(
          el(
            "div",
            "cm-dbml-hover-muted",
            `Ref: ${ref.left.table}.${ref.left.fields.join(",")} ${ref.relation} ${ref.right.table}.${ref.right.fields.join(",")}`,
          ),
        );
      }
      return make(root);
    }

    return null;
  },
  { hoverTime: 320 },
);
