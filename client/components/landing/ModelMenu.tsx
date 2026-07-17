"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LlmProvider, LlmUsage } from "@/lib/types";

const USAGE_LABEL: Record<LlmUsage, string> = { low: "low usage", mid: "mid usage", high: "high usage" };
// Reuses the existing status vocabulary (queued/retry/fail) instead of a new
// traffic-light palette: low = no big deal, mid = moderate, high = heaviest
// on quota/cost/latency.
const USAGE_CLASS: Record<LlmUsage, string> = {
  low: "bg-foreman-queued-bg text-foreman-queued-text",
  mid: "bg-foreman-retry-bg text-foreman-retry-text",
  high: "bg-foreman-fail-bg text-foreman-fail-text",
};

function UsageBadge({ usage }: { usage: LlmUsage }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${USAGE_CLASS[usage]}`}
      title={`Relative quota/cost tier: ${USAGE_LABEL[usage]}`}
    >
      {usage}
    </span>
  );
}

export default function ModelMenu({
  providers,
  selected,
  onChange,
}: {
  providers: LlmProvider[];
  selected: string | null;
  onChange: (model: string) => void;
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

  const allModels = useMemo(
    () => providers.flatMap((p) => p.models.map((m) => ({ provider: p.name, ...m }))),
    [providers]
  );
  const current = allModels.find((m) => m.model === selected) ?? allModels[0] ?? null;
  const single = allModels.length <= 1;

  return (
    <div ref={ref} className="relative ml-auto inline-flex">
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Active LLM model (GET /llm/providers) — select which one runs this migration"
        disabled={single}
        className="inline-flex items-center gap-1.5 rounded-full border border-foreman-line bg-foreman-bg px-2.5 py-1 pr-2 text-[12.5px] font-medium text-foreman-ink disabled:cursor-default enabled:hover:bg-foreman-queued-bg"
      >
        <span className="font-mono">{current ? current.model : "…"}</span>
        <ChevronDown size={9} className="text-foreman-faint" />
      </button>
      {open && !single && (
        <div
          role="menu"
          aria-label="Model"
          className="absolute bottom-[calc(100%+8px)] right-0 z-30 max-h-[360px] w-[280px] overflow-y-auto rounded-card border border-foreman-line bg-foreman-card p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)]"
        >
          {providers.map((provider) => (
            <div key={provider.name}>
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreman-faint first:pt-1.5">
                {provider.name}
              </div>
              {provider.models.map((m) => (
                <button
                  key={m.model}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m.model === current?.model}
                  onClick={() => {
                    onChange(m.model);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-foreman-bg ${
                    m.model === current?.model ? "bg-foreman-queued-bg" : ""
                  }`}
                >
                  <span className="truncate font-mono text-[12.5px] text-foreman-ink">{m.model}</span>
                  <UsageBadge usage={m.usage} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
