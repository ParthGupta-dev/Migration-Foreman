"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type ComposerMode = "scan" | "describe" | "autonomous";

// Display labels match landing.html's mock exactly (Manual/Auto/Plan) — the
// internal keys stay the backend-semantic scan/describe/autonomous used by
// the section-2 contract map and campaignStore's StoredCampaign.mode.
const MODES: Record<ComposerMode, { label: string; hint: string; key: string }> = {
  scan: {
    label: "Manual",
    hint: "Ranks the highest-leverage candidates found during ingest. You pick one.",
    key: "1",
  },
  autonomous: {
    label: "Auto",
    hint: "Commits to its top-ranked candidate; you approve or veto. Refuses blacklisted picks — no silent fallback.",
    key: "2",
  },
  describe: {
    label: "Plan",
    hint: "Describe the migration in plain English. Foreman drafts and grounds a spec before you approve.",
    key: "3",
  },
};

export { MODES };

export default function ModeMenu({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      const entry = Object.entries(MODES).find(([, m]) => m.key === e.key);
      if (entry) {
        onChange(entry[0] as ComposerMode);
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onChange]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-foreman-line bg-foreman-bg px-2.5 py-1.5 text-[12.5px] font-medium text-foreman-ink hover:bg-foreman-queued-bg"
      >
        <span>{MODES[mode].label}</span>
        <ChevronDown size={9} className="text-foreman-faint" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Mode"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[220px] rounded-card border border-foreman-line bg-foreman-card p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)]"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreman-faint">
            Mode
          </div>
          {(Object.keys(MODES) as ComposerMode[]).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={mode === key}
              title={MODES[key].hint}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-foreman-bg ${
                mode === key ? "font-semibold text-foreman-ink" : "text-foreman-ink"
              }`}
            >
              <span>{MODES[key].label}</span>
              <span className={`font-mono text-xs ${mode === key ? "text-foreman-ink font-semibold" : "text-foreman-faint"}`}>
                {mode === key ? "✓" : MODES[key].key}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
