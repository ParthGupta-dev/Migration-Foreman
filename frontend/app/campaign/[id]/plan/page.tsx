"use client";

import { useCampaign } from "@/lib/campaignContext";
import PageScaffold, { PhaseNote } from "@/components/PageScaffold";

export default function PlanPage() {
  const { stored } = useCampaign();

  return (
    <PageScaffold title="Plan" sub="Read-only record of the agreed migration plan.">
      <PhaseNote>
        <p className="mb-2 text-foreman-ink">
          The full plan record (quoted intent, grounded before/after, batch breakdown, grounding
          stats, blast-radius graph) is built in Phase 5 (mock:{" "}
          <span className="font-mono">plan.html</span>).
        </p>
        {stored ? (
          <p>
            Plan record found for{" "}
            <span className="font-mono text-foreman-ink">{stored.title}</span> — mode{" "}
            <span className="font-mono text-foreman-ink">{stored.mode}</span>, model{" "}
            <span className="font-mono text-foreman-ink">{stored.model}</span>.
          </p>
        ) : (
          <p>No plan record on this browser (gap G2 — plan data is per-browser until Phase 8).</p>
        )}
      </PhaseNote>
    </PageScaffold>
  );
}
