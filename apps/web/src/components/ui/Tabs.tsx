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

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * Three shapes for the same control. `line` heads a page, `boxed` is the
 * segmented switch inside a card, `pill` is the standalone filter row — all on
 * the 28px control height so a tab strip lines up with the buttons beside it.
 */
export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  variant = "pill",
  className = "",
}: TabsProps<T>) {
  if (variant === "line") {
    return (
      <div role="tablist" className={`flex gap-5 border-b border-border ${className}`.trim()}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-[12.5px] font-semibold transition-colors duration-150 ${FOCUS_RING} ${
                active
                  ? "border-primary text-text"
                  : "border-transparent text-text-muted hover:border-border-strong hover:text-text-secondary"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                    active ? "bg-primary-light text-primary" : "bg-surface-hover text-text-muted"
                  }`}
                >
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
      <div role="tablist" className={`flex gap-1 rounded-lg border border-border bg-surface p-1 ${className}`.trim()}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors duration-150 ${FOCUS_RING} ${
                active
                  ? "border border-border-strong bg-surface-raised font-semibold text-text shadow-xs"
                  : "border border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
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
    <div role="tablist" className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-150 ${FOCUS_RING} ${
              active
                ? "border border-primary bg-primary font-semibold text-white"
                : "border border-border bg-surface-raised text-text-secondary hover:bg-surface-hover hover:text-text"
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
