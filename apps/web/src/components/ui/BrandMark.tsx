import { LogoMarkIcon } from "@/components/icons/Icons";

/** The gradient square logo mark used in every header and the auth-page cards. */
export function BrandMark(props: { size?: number; iconSize?: number; className?: string }) {
  const size = props.size ?? 26;
  return (
    <span
      className={`flex items-center justify-center rounded-sm bg-gradient-to-br from-primary to-[#7c3aed] text-white ${props.className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <LogoMarkIcon size={props.iconSize ?? 15} style={{ color: "white" }} />
    </span>
  );
}
