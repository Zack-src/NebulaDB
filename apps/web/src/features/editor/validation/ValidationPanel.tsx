import type { ReactNode } from "react";
import type { ValidationIssue } from "@athanordb/dbml-engine";
import { AlertTriangleIcon, CheckCircleIcon, type IconProps } from "@/components/icons/Icons";
import { Modal } from "@/components/overlays/Modal";
import { useTranslation } from "@/i18n/useTranslation";

const SEVERITY_ICON: Record<ValidationIssue["severity"], (p: IconProps) => ReactNode> = {
  error: (p) => <AlertTriangleIcon {...p} />,
  warning: (p) => <AlertTriangleIcon {...p} />,
};

const SEVERITY_CLASS: Record<ValidationIssue["severity"], string> = {
  error: "text-danger bg-danger-light",
  warning: "text-warning bg-warning-light",
};

/** Structural check (`validateProject`, computed client-side — it's pure `Project` analysis with no `@dbml/core` dependency, safe to run on every doc change). Informational only — nothing here blocks editing. */
function ValidationPanel(props: { issues: ValidationIssue[]; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal title={t("validation.title")} onClose={props.onClose}>
      {props.issues.length === 0 ? (
        <div className="flex items-center gap-2 py-1 text-[13.5px] text-success">
          <CheckCircleIcon size={16} /> {t("validation.noIssues")}
        </div>
      ) : (
        <div className="flex max-h-[400px] flex-col gap-0.5 overflow-y-auto">
          {props.issues.map((issue, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-sm px-[9px] py-2 text-[13px] leading-snug ${SEVERITY_CLASS[issue.severity]}`}>
              {SEVERITY_ICON[issue.severity]({ size: 14, className: "mt-0.5 shrink-0" })}
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export { ValidationPanel };
export default ValidationPanel;
