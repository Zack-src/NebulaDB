import { useState } from "react";
import { ChevronLeftIcon } from "./Icons.js";
import { AuditTab } from "./admin/AuditTab.js";
import { InvitationsTab } from "./admin/InvitationsTab.js";
import { TeamsTab } from "./admin/TeamsTab.js";
import { UsersTab } from "./admin/UsersTab.js";
import { Button } from "./ui/Button.js";
import { BrandMark } from "./ui/BrandMark.js";
import { APP_HEADER, APP_SHELL } from "./ui/layout.js";

const SECTIONS = [
  { key: "invitations", label: "Invitations" },
  { key: "teams", label: "Équipes" },
  { key: "users", label: "Utilisateurs" },
  { key: "audit", label: "Journal d'audit" },
] as const;
type Section = (typeof SECTIONS)[number]["key"];

function AdminConsole(props: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("invitations");

  return (
    <div className={APP_SHELL}>
      <header className={APP_HEADER}>
        <Button variant="ghost" size="icon" onClick={props.onClose} data-tooltip="Retour aux projets">
          <ChevronLeftIcon size={16} />
        </Button>
        <BrandMark size={24} iconSize={13} />
        <span className="mr-1.5 whitespace-nowrap text-[13.5px] font-semibold">Console d'administration</span>
      </header>
      <div className="h-full overflow-y-auto px-6 py-12">
        <div className="mx-auto max-w-[880px]">
          <div className="mb-[18px] flex gap-3.5 border-b border-border">
            {SECTIONS.map((s) => {
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  className={`-mb-px border-b-2 py-2 text-[13px] font-semibold ${
                    active ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"
                  }`}
                  onClick={() => setSection(s.key)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {section === "invitations" && <InvitationsTab />}
          {section === "teams" && <TeamsTab />}
          {section === "users" && <UsersTab />}
          {section === "audit" && <AuditTab />}
        </div>
      </div>
    </div>
  );
}

export { AdminConsole };
export default AdminConsole;
