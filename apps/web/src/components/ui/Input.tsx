import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { INPUT_CLASS, INPUT_INVALID_CLASS, INPUT_SM_CLASS, INPUT_XS_CLASS } from "@/components/ui/inputStyles";

type InputSize = "md" | "sm" | "xs";

const SIZE_CLASS: Record<InputSize, string> = {
  md: INPUT_CLASS,
  sm: INPUT_SM_CLASS,
  xs: INPUT_XS_CLASS,
};

/** Left padding when a leading icon is rendered, per size. */
const ICON_PADDING: Record<InputSize, string> = {
  md: "pl-8",
  sm: "pl-7",
  xs: "pl-[26px]",
};

const ICON_OFFSET: Record<InputSize, string> = {
  md: "left-2.5",
  sm: "left-2",
  xs: "left-1.5",
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  inputSize?: InputSize;
  /** Rendered inside the field, before the text (search glass, folder, hash…). */
  icon?: ReactNode;
  /** Rendered inside the field, after the text (unit, counter, small button). */
  trailing?: ReactNode;
  invalid?: boolean;
  /** Class applied to the wrapper rather than the input — put layout (width/flex) here. */
  wrapperClassName?: string;
}

/**
 * Text field with optional in-field icon/adornment. Without either it renders a
 * bare `<input>` so it stays a drop-in replacement for the raw element.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", icon, trailing, invalid, className = "", wrapperClassName = "", ...rest },
  ref,
) {
  const base = `${SIZE_CLASS[inputSize]} ${invalid ? INPUT_INVALID_CLASS : ""}`;

  if (!icon && !trailing) {
    return (
      <input ref={ref} className={`${base} ${wrapperClassName} ${className}`.replace(/\s+/g, " ").trim()} {...rest} />
    );
  }

  return (
    <div className={`relative flex items-center ${wrapperClassName}`}>
      {icon && (
        <span className={`pointer-events-none absolute ${ICON_OFFSET[inputSize]} flex text-text-muted`}>{icon}</span>
      )}
      <input
        ref={ref}
        className={`${base} w-full ${icon ? ICON_PADDING[inputSize] : ""} ${trailing ? "pr-8" : ""} ${className}`
          .replace(/\s+/g, " ")
          .trim()}
        {...rest}
      />
      {trailing && <span className="absolute right-2 flex items-center text-text-muted">{trailing}</span>}
    </div>
  );
});
