import { useState } from "react";
import { ChevronLeftIcon } from "@/components/icons/Icons";
import { AuditTab } from "@/features/admin/AuditTab";
import { ErrorsTab } from "@/features/admin/ErrorsTab";
import { InvitationsTab } from "@/features/admin/InvitationsTab";
import { TeamsTab } from "@/features/admin/TeamsTab";
import { UsersTab } from "@/features/admin/UsersTab";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { APP_HEADER, APP_SHELL } from "@/components/ui/layout";
import { useTranslation } from "@/i18n/useTranslation";
import type { TranslationKeyOf } from "@/types";

const SECTIONS = [
  { key: "invitations", labelKey: "admin.section.invitations" },
  { key: "teams", labelKey: "admin.section.teams" },
  { key: "users", labelKey: "admin.section.users" },
  { key: "audit", labelKey: "admin.section.audit" },
  { key: "errors", labelKey: "admin.section.errors" },
] as const satisfies readonly { key: string; labelKey: TranslationKeyOf }[];

type Section = (typeof SECTIONS)[number]["key"];

function AdminConsole({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("invitations");

  return (
    <div className={APP_SHELL}>
      <header className={APP_HEADER}>
        <Button variant="ghost" size="icon" onClick={onClose} data-tooltip={t("admin.backToProjects")}>
          <ChevronLeftIcon size={16} />
        </Button>
        <BrandMark size={24} iconSize={13} />
        <span className="mr-1.5 whitespace-nowrap text-[13.5px] font-semibold">{t("admin.title")}</span>
      </header>
      <div className="h-full overflow-y-auto px-6 py-12">
        <div className="mx-auto max-w-[880px]">
          <div className="mb-[18px] flex gap-3.5 border-b border-border">
            {SECTIONS.map(({ key, labelKey }) => (
              <button
                key={key}
                className={`-mb-px border-b-2 py-2 text-[13px] font-semibold ${
                  section === key ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"
                }`}
                onClick={() => setSection(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
          {section === "invitations" && <InvitationsTab />}
          {section === "teams" && <TeamsTab />}
          {section === "users" && <UsersTab />}
          {section === "audit" && <AuditTab />}
          {section === "errors" && <ErrorsTab />}
        </div>
      </div>
    </div>
  );
}

export { AdminConsole };
export default AdminConsole;
