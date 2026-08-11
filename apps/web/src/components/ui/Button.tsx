import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "gradient" | "glow" | "outline" | "ghost" | "danger" | "danger-ghost";
type Size = "md" | "sm" | "lg" | "icon" | "icon-sm";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13px] font-semibold " +
  "transition-all duration-150 ease-out active:scale-[0.98] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-border " +
  "disabled:cursor-default disabled:opacity-50 disabled:pointer-events-none";

const VARIANT: Record<Variant, string> = {
  default:
    "border border-border/80 bg-surface-raised/80 text-text-secondary enabled:hover:border-border-strong enabled:hover:bg-surface-hover enabled:hover:text-text shadow-sm",
  primary: "border border-primary bg-primary text-white font-bold enabled:hover:bg-primary-hover shadow-md",
  gradient: "border border-indigo-400/30 bg-indigo-600 text-white font-bold enabled:hover:bg-indigo-500 shadow-md",
  glow: "border border-indigo-400/40 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold glow-indigo enabled:hover:brightness-110 shadow-lg",
  outline: "border border-border-strong/90 bg-surface-raised/50 text-text enabled:hover:bg-surface-hover enabled:hover:border-primary/80 shadow-xs",
  ghost:
    "border border-transparent bg-transparent text-text-secondary enabled:hover:bg-surface-hover/80 enabled:hover:text-text",
  danger: "border border-danger/40 bg-danger/10 text-danger enabled:hover:border-danger enabled:hover:bg-danger/20",
  "danger-ghost": "border border-transparent bg-transparent text-danger enabled:hover:bg-danger-light",
};


const SIZE: Record<Size, string> = {
  lg: "px-5 py-2.5 text-sm font-bold",
  md: "px-3.5 py-1.5",
  sm: "px-2.5 py-1 text-xs",
  icon: "h-[32px] w-[32px] p-1.5",
  "icon-sm": "h-6 w-6 p-1",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Toggle-pressed visual state (e.g. the active detail-level button). */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", active, className = "", type = "button", ...rest },
  ref,
) {
  const activeCls = active ? "!border-primary-border !bg-primary-light !text-primary font-bold shadow-xs" : "";
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${activeCls} ${className}`.trim()}
      {...rest}
    />
  );
});

