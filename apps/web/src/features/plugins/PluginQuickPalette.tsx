import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, SparklesIcon, SettingsIcon, CodeIcon } from "@/components/icons/Icons";
import { CONTEXT_MENU_ITEM_CLASS } from "@/components/ui/contextMenuStyles";
import type { CanvasCommandContribution, ResolvedContribution } from "@/features/plugins/types";
import { useTranslation } from "@/i18n/useTranslation";

export interface PluginQuickPaletteProps {
  commands: ResolvedContribution<CanvasCommandContribution>[];
  onRun: (command: ResolvedContribution<CanvasCommandContribution>) => void;
  onOpenPlugins: () => void;
  onClose: () => void;
}

export function PluginQuickPalette({ commands, onRun, onOpenPlugins, onClose }: PluginQuickPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredCommands = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.contribution.label.toLowerCase().includes(q) ||
        (c.contribution.description && c.contribution.description.toLowerCase().includes(q)) ||
        c.plugin.name.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((idx) => (idx - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        onRun(filteredCommands[selectedIndex]);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="flex flex-col w-[300px] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl animate-popover-in"
      onKeyDown={handleKeyDown}
    >
      {/* Search Bar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised/80 px-3 py-2">
        <SearchIcon size={14} className="text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t("plugins.quickPalettePlaceholder")}
          className="w-full bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-hidden"
        />
      </div>

      {/* Commands List */}
      <div className="max-h-64 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {filteredCommands.map((command, idx) => {
          const isSelected = idx === selectedIndex;
          const isBuiltin = command.source === "builtin";

          return (
            <button
              key={command.key}
              type="button"
              className={`${CONTEXT_MENU_ITEM_CLASS} justify-between text-left ${isSelected ? "bg-surface-hover text-text font-medium" : ""}`}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => {
                onRun(command);
                onClose();
              }}
              data-tooltip={command.contribution.description}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isBuiltin ? (
                  <SparklesIcon size={13} className="text-primary shrink-0" />
                ) : (
                  <CodeIcon size={13} className="text-accent-cyan shrink-0" />
                )}
                <span className="truncate text-xs">{command.contribution.label}</span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {command.contribution.shortcut && (
                  <span className="rounded bg-surface-raised px-1 py-0.5 text-[9.5px] font-mono text-text-muted">
                    {command.contribution.shortcut}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {filteredCommands.length === 0 && (
          <div className="py-6 text-center text-xs text-text-muted">{t("plugins.noMatchForQuery", { query })}</div>
        )}
      </div>

      {/* Footer link to Manager */}
      <div className="border-t border-border bg-surface-raised/60 p-1.5">
        <button
          type="button"
          className={`${CONTEXT_MENU_ITEM_CLASS} w-full justify-between text-xs text-text-muted hover:text-text`}
          onClick={() => {
            onClose();
            onOpenPlugins();
          }}
        >
          <div className="flex items-center gap-2">
            <SettingsIcon size={13} />
            <span>{t("plugins.managePlugins")}</span>
          </div>
          <span className="text-[10px] text-text-muted">{t("plugins.exploreAndCreate")}</span>
        </button>
      </div>
    </div>
  );
}
