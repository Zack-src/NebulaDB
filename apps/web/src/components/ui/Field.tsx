import type { ReactNode } from "react";
import { Input, type InputProps } from "@/components/ui/Input";
import { LABEL_CLASS } from "@/components/ui/inputStyles";

/** Vertically-stacked label + field, used on auth screens and settings forms. Pass `hint` for helper text, `error` for a validation message (which also turns the field red). */
export function Field(props: { label: ReactNode; hint?: ReactNode; error?: ReactNode } & InputProps) {
  const { label, hint, error, className = "", ...rest } = props;
  return (
    <label className="mb-4 flex flex-col gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      <Input className={className} invalid={Boolean(error)} wrapperClassName="w-full" {...rest} />
      {error ? (
        <span className="text-[11.5px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
