"use client";

import type { DiscoveredSeam } from "@/lib/types";

export default function AutoPick({
  seam,
  confirming,
  onConfirm,
  onVetoShowAll,
}: {
  seam: DiscoveredSeam | null;
  confirming: boolean;
  onConfirm: () => void;
  onVetoShowAll: () => void;
}) {
  if (!seam) {
    return (
      <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
        <p className="text-sm text-foreman-dim">Foreman couldn&apos;t find a migration to propose from that objective.</p>
      </section>
    );
  }

  if (!seam.testCommand || !seam.testCommand.trim()) {
    return (
      <section className="rounded-card border border-[#D9A99A] bg-[#F7EEE9] p-6 shadow-card">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreman-fail-text">
          Autonomous refused
        </h2>
        <p className="text-sm text-foreman-ink">
          Top-ranked seam <span className="font-mono">{seam.title}</span> has no verification command and
          Foreman won&apos;t execute a migration it can&apos;t test — no silent fallback to a different pick.
        </p>
        <button
          type="button"
          onClick={onVetoShowAll}
          className="mt-4 rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
        >
          Show all candidates instead
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-foreman-dim">Foreman&apos;s pick</h2>
      <div className="flex items-baseline gap-4 pb-1">
        <span className="h-2 w-2 flex-none rounded-full bg-foreman-run" />
        <span className="font-mono text-[13px] text-foreman-ink">{seam.title}</span>
        <span className="flex-1 text-xs text-foreman-dim">{seam.reasoning}</span>
      </div>
      <dl className="mt-4 grid grid-cols-[160px_1fr] gap-y-2 text-[13px] border-t border-foreman-line pt-4">
        <dt className="text-foreman-dim">Scope</dt>
        <dd className="font-mono tabular-nums">{seam.scopeGlobs.join(" · ")}</dd>
        <dt className="text-foreman-dim">Test command</dt>
        <dd className="font-mono tabular-nums">{seam.testCommand}</dd>
        <dt className="text-foreman-dim">Grounding</dt>
        <dd className="font-mono tabular-nums">
          {seam.occurrences} occurrences across {seam.groundedFiles.length} files
        </dd>
      </dl>
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onVetoShowAll}
          className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
        >
          Veto — show all candidates
        </button>
        <button
          type="button"
          disabled={confirming}
          onClick={onConfirm}
          className="rounded-ctl bg-foreman-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-50"
        >
          {confirming ? "Approving…" : "Approve pick"}
        </button>
      </div>
    </section>
  );
}
