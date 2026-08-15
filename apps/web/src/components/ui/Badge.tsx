import type { ReactNode } from "react";

type Tone = "admin" | "muted" | "warning" | "success" | "danger";

const TONE: Record<Tone, string> = {
  admin: "bg-primary-light text-primary",
  muted: "bg-surface-hover text-text-muted",
  warning: "bg-warning-light text-warning",
  success: "bg-success-light text-success",
  danger: "bg-danger-light text-danger",
};

/** Small uppercase pill — admin/view-only/invitation-status labels. */
export function Badge(props: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-full px-1.5 py-px text-[10px] font-bold uppercase ${TONE[props.tone]} ${props.className ?? ""}`.trim()}
    >
      {props.children}
    </span>
  );
}
