"use client";

// The blocked strip (frontend_refactor.md §2 / Phase 4 item 2). blocked /
// generation_failed / system_error units are terminal *infra* failures, not
// engineering-judgement escalations, so they never colour a batch tile — they
// surface here as their own labelled group. No mock exists for this (the mock
// campaign has none); it's built from the same tokens as everything else.

import type { Unit } from "@/lib/types";
import FileCard from "./FileCard";

export default function BlockedStrip({
  units,
  campaignId,
}: {
  units: Unit[];
  campaignId: string;
}) {
  if (units.length === 0) return null;

  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-foreman-dim">
          Blocked
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-foreman-fail-bg px-2.5 py-0.5 text-xs font-semibold text-foreman-fail-text">
          {units.length}
        </span>
        <span className="text-xs text-foreman-dim">
          provider / generation / system failures — not part of the review queue
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {units.map((unit) => (
          <FileCard key={unit.unitId} unit={unit} campaignId={campaignId} />
        ))}
      </div>
    </section>
  );
}
