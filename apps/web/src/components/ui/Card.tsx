import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "glass" | "glow" | "outline";
  interactive?: boolean;
}

export function Card({ children, variant = "default", interactive = false, className = "", ...rest }: CardProps) {
  const baseStyles = "rounded-xl border transition-[transform,border-color,box-shadow] duration-150 ease-out";

  const variantStyles = {
    default: "bg-surface border-border shadow-xs",
    // Explicit border colour: `.glass-card` only owns the fill and the blur
    // now, and preflight is disabled — a bare `border` with no colour utility
    // would paint in `currentColor`.
    glass: "glass-card border-white/[0.06] shadow-sm",
    glow: "bg-surface-raised border-primary-border shadow-lg",
    outline: "bg-transparent border-border hover:border-border-strong",
  }[variant];

  // A half-pixel lift, not a hop: the card should acknowledge the cursor, not
  // jump out from under it.
  const hoverStyles = interactive
    ? "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
    : "";

  return (
    <div className={`${baseStyles} ${variantStyles} ${hoverStyles} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-b border-border px-5 pb-4 pt-5 ${className}`.trim()}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`.trim()}>{children}</div>;
}
