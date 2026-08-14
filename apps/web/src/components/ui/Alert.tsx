import type { ReactNode } from "react";

/** Inline error banner used under forms and in modals. */
export function ErrorText(props: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-2.5 rounded-md border border-danger/35 bg-danger-light px-2.5 py-2 text-[12.5px] leading-normal text-danger"
    >
      {props.children}
    </div>
  );
}

/** Muted explanatory paragraph used at the top of modal bodies. */
export function Hint(props: { children: ReactNode }) {
  return <p className="mb-3 text-[12.5px] leading-normal text-text-muted">{props.children}</p>;
}
