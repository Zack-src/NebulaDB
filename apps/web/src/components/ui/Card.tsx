import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "glass" | "glow" | "outline";
  interactive?: boolean;
}

export function Card({ children, variant = "default", interactive = false, className = "", ...rest }: CardProps) {
  const baseStyles = "rounded-xl border transition-all duration-200";
  
  const variantStyles = {
    default: "bg-surface border-border shadow-sm",
    glass: "glass-card shadow-md",
    glow: "bg-surface-raised border-primary-border glow-indigo shadow-lg",
    outline: "bg-transparent border-border hover:border-border-strong",
  }[variant];

  const hoverStyles = interactive
    ? "hover:-translate-y-1 hover:border-primary/50 hover:shadow-md cursor-pointer"
    : "";

  return (
    <div className={`${baseStyles} ${variantStyles} ${hoverStyles} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 pt-6 pb-3 border-b border-border/50 ${className}`.trim()}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-6 ${className}`.trim()}>{children}</div>;
}
