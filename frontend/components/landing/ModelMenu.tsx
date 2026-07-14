"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LlmProvider } from "@/lib/types";

export default function ModelMenu({
  providers,
  selected,
  onChange,
}: {
  providers: LlmProvider[];
  selected: string | null;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (open && e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = providers.find((p) => p.name === selected) ?? providers[0] ?? null;
  const single = providers.length <= 1;

  return (
    <div ref={ref} className="relative ml-auto inline-flex">
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Active LLM provider (GET /llm/providers) — select which one runs this migration"
        disabled={single}
        className="inline-flex items-center gap-1.5 rounded-full border border-foreman-line bg-foreman-bg px-2.5 py-1 pr-2 text-[12.5px] font-medium text-foreman-ink disabled:cursor-default enabled:hover:bg-foreman-queued-bg"
      >
        {current ? current.name : "…"}
        <ChevronDown size={9} className="text-foreman-faint" />
      </button>
      {open && !single && (
        <div
          role="menu"
          aria-label="Model"
          className="absolute bottom-[calc(100%+8px)] right-0 z-30 w-[220px] rounded-card border border-foreman-line bg-foreman-card p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)]"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreman-faint">
            Model
          </div>
          {providers.map((p) => (
            <button
              key={p.name}
              type="button"
              role="menuitemradio"
              aria-checked={p.name === current?.name}
              onClick={() => {
                onChange(p.name);
                setOpen(false);
              }}
              className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-foreman-bg ${
                p.name === current?.name ? "bg-foreman-queued-bg" : ""
              }`}
            >
              <span className="text-[13px] font-semibold text-foreman-ink">{p.name}</span>
              <span className="font-mono text-[11px] text-foreman-faint">{p.model}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
