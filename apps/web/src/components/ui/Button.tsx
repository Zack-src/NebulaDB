import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "gradient" | "glow" | "outline" | "ghost" | "danger" | "danger-ghost";
type Size = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

/**
 * Buttons are flat by default and carry their weight in the border and the
 * fill, not in a drop shadow — the same way Figma's own toolbar and dialog
 * buttons read. Only `primary` keeps a hairline shadow, to lift the one control
 * that is meant to be the obvious next step.
 *
 * `disabled` deliberately does *not* set `pointer-events: none`: every variant
 * already guards its hover with `enabled:`, and killing pointer events also
 * kills the tooltip explaining *why* the button is disabled.
 */
const BASE =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold leading-none " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:enabled:scale-[0.98] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

const VARIANT: Record<Variant, string> = {
  default:
    "border border-border bg-surface-raised text-text-secondary enabled:hover:border-border-strong enabled:hover:bg-surface-hover enabled:hover:text-text",
  primary:
    "border border-primary bg-primary text-white enabled:hover:border-primary-hover enabled:hover:bg-primary-hover shadow-xs",
  gradient: "border border-indigo-400/30 bg-indigo-600 text-white enabled:hover:bg-indigo-500 shadow-xs",
  glow: "border border-indigo-400/40 bg-gradient-to-r from-indigo-600 to-violet-600 text-white enabled:hover:brightness-110 shadow-md",
  outline:
    "border border-border-strong bg-transparent text-text enabled:hover:border-primary enabled:hover:bg-surface-hover",
  ghost:
    "border border-transparent bg-transparent text-text-secondary enabled:hover:bg-surface-hover enabled:hover:text-text",
  danger: "border border-danger/45 bg-danger-light text-danger enabled:hover:border-danger enabled:hover:bg-danger/20",
  "danger-ghost": "border border-transparent bg-transparent text-danger enabled:hover:bg-danger-light",
};

/**
 * One height ramp — 24 / 28 / 32 / 40 — shared with the field sizes in
 * `inputStyles.ts`, so a button dropped next to an input in a toolbar or form
 * row lines up instead of sitting a few pixels proud of it. Heights are
 * explicit rather than emergent from padding + line-height, which is what let
 * `sm` buttons and `sm` fields drift 6px apart.
 */
const SIZE: Record<Size, string> = {
  lg: "h-10 px-4 text-[13.5px]",
  md: "h-8 px-3 text-[13px]",
  sm: "h-7 px-2.5 text-[12.5px]",
  xs: "h-6 px-2 text-[11.5px]",
  icon: "h-8 w-8 text-[13px]",
  "icon-sm": "h-7 w-7 text-[12.5px]",
  "icon-xs": "h-6 w-6 text-[11.5px]",
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
  const activeCls = active ? "!border-primary-border !bg-primary-light !text-primary" : "";

  // An icon-only button has no text node, so its only name was `data-tooltip` —
  // a plain data attribute no screen reader ever reads. Every `icon*` size is
  // icon-only by definition, so the tooltip doubles as the accessible name
  // unless the call site gave a better one.
  const tooltip = (rest as { "data-tooltip"?: unknown })["data-tooltip"];
  const derivedLabel =
    size.startsWith("icon") && !rest["aria-label"] && !rest["aria-labelledby"] && typeof tooltip === "string"
      ? tooltip
      : undefined;

  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${activeCls} ${className}`.trim()}
      {...rest}
      aria-label={rest["aria-label"] ?? derivedLabel}
    />
  );
});
