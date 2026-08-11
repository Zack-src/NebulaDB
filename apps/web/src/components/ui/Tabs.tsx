import type { ReactNode } from "react";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  variant?: "pill" | "line" | "boxed";
  className?: string;
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  variant = "pill",
  className = "",
}: TabsProps<T>) {
  if (variant === "line") {
    return (
      <div className={`flex border-b border-border gap-6 ${className}`.trim()}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 pb-2.5 text-xs font-semibold tracking-wide transition-all border-b-2 ${
                active
                  ? "border-primary text-text font-bold"
                  : "border-transparent text-text-muted hover:text-text-secondary hover:border-border-strong"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? "bg-primary/20 text-primary" : "bg-surface-raised text-text-muted"}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === "boxed") {
    return (
      <div className={`flex gap-1.5 p-1 bg-surface-raised/60 rounded-lg border border-border/50 ${className}`.trim()}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                active
                  ? "bg-surface text-text shadow-sm border border-border/80 font-semibold"
                  : "text-text-muted hover:text-text hover:bg-surface-hover/50"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Default: pill
  return (
    <div className={`flex gap-2 ${className}`.trim()}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              active
                ? "bg-primary text-white shadow-sm glow-indigo font-semibold"
                : "bg-surface-raised/50 text-text-secondary hover:bg-surface-hover hover:text-text border border-border/40"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
