"use client";

// Top of the content area (frontend_refactor.md Phase 3, foreman.css
// `.topstrip`): campaign name, live state chip, accent progress bar +
// `n/m accepted` fraction. Shared across all six pages via the layout.

import { useCampaign } from "@/lib/campaignContext";

export default function TopStrip() {
  const { campaign, stored, campaignId, accepted, total } = useCampaign();
  const name = stored?.title ?? campaignId.slice(0, 8);
  const chip = stateChip(campaign?.status);
  const pct = total > 0 ? Math.round((accepted / total) * 100) : 0;

  return (
    <header className="border-b border-foreman-line bg-foreman-card px-8 pt-4">
      <div className="flex items-center gap-4 pb-3.5">
        <span className="text-[15px] font-semibold">{name}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.pill}`}
        >
          <span className={`h-2 w-2 rounded-full ${chip.lamp}`} />
          {chip.label}
        </span>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-foreman-dim">
          {total > 0 ? `${accepted}/${total} accepted` : "—"}
        </span>
      </div>
      <div className="-mx-8 h-[3px] bg-foreman-queued-bg">
        <div
          className="h-full rounded-r-[2px] bg-foreman-ok transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </header>
  );
}

function stateChip(status: string | undefined): { label: string; pill: string; lamp: string } {
  switch (status) {
    case "completed":
      return { label: "Completed", pill: "bg-foreman-ok-bg text-foreman-ok-text", lamp: "bg-foreman-ok" };
    case "failed":
      return { label: "Failed", pill: "bg-foreman-fail-bg text-foreman-fail-text", lamp: "bg-foreman-fail" };
    case "running":
      return { label: "Running", pill: "bg-foreman-run-bg text-foreman-run-text", lamp: "bg-foreman-run pulse" };
    default:
      return { label: "Connecting…", pill: "bg-foreman-queued-bg text-foreman-queued-text", lamp: "bg-foreman-queued" };
  }
}
