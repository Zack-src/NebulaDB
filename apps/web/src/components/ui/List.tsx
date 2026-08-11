import type { ReactNode } from "react";

/** Dashed placeholder shown instead of a list/grid when there's nothing to show yet. */
export function EmptyState(props: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-muted">
      {props.children}
    </div>
  );
}

/** Vertical stack of `ListRow`s — used for admin tables (invitations/users/teams/team members). */
export function List(props: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{props.children}</div>;
}

export function ListRow(props: { children: ReactNode }) {
  return <div className="flex items-center gap-2.5 rounded-sm border border-border bg-surface px-3 py-2.5">{props.children}</div>;
}

/** The row's primary label/content cluster — flexes to fill the row, leaving action buttons at fixed width. */
export function ListMain(props: { children: ReactNode; as?: "div" | "button"; onClick?: () => void }) {
  const className = "flex min-w-0 flex-1 items-center gap-2 text-[13px]";
  if (props.as === "button") {
    return (
      <button className={`${className} cursor-pointer border-none bg-none p-0 text-left text-text`} onClick={props.onClick}>
        {props.children}
      </button>
    );
  }
  return <div className={className}>{props.children}</div>;
}
