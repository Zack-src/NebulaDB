import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";

export interface PaletteItem {
  id: string;
  label: string;
  /** right-hand side text: shortcut, type, field count… */
  hint?: string;
  kind?: string;
  detail?: string;
  run: () => void;
}

/** Subsequence match with a bonus for prefix / word-start hits; null when it doesn't match. */
function score(query: string, text: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  let qi = 0;
  let points = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      points += i === 0 || /[^A-Za-z0-9]/.test(t[i - 1]) ? 8 : 3;
      qi += 1;
    }
  }
  return qi === q.length ? points - t.length * 0.1 : null;
}

export function CommandPalette(props: {
  items: PaletteItem[];
  placeholder: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const scored = props.items
      .map((item) => ({ item, s: score(query, `${item.label} ${item.detail ?? ""}`) }))
      .filter((r): r is { item: PaletteItem; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.item);
    return scored.slice(0, 200);
  }, [props.items, query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const commit = (item: PaletteItem | undefined) => {
    if (!item) return;
    props.onClose();
    item.run();
  };

  return (
    <div
      className="absolute inset-0 z-40 flex justify-center bg-black/40 pt-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="flex max-h-[70%] w-[92%] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <input
          autoFocus
          value={query}
          placeholder={props.placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              commit(filtered[index]);
            }
            event.stopPropagation();
          }}
          className="w-full border-b border-border bg-transparent px-3 py-2.5 text-[13px] text-text outline-hidden placeholder:text-text-muted"
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-text-muted">{t("commandPalette.noMatch")}</div>}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              data-idx={i}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => commit(item)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
                i === index ? "bg-primary text-white" : "text-text hover:bg-surface-hover"
              }`}
            >
              {item.kind && (
                <span
                  className={`shrink-0 rounded px-1 py-px text-[10px] uppercase tracking-wide ${
                    i === index ? "bg-white/20 text-white" : "bg-border text-text-muted"
                  }`}
                >
                  {item.kind}
                </span>
              )}
              <span className="truncate">{item.label}</span>
              {item.detail && (
                <span className={`truncate text-[11px] ${i === index ? "text-white/70" : "text-text-muted"}`}>
                  {item.detail}
                </span>
              )}
              {item.hint && (
                <span className={`ml-auto shrink-0 text-[11px] ${i === index ? "text-white/70" : "text-text-muted"}`}>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
