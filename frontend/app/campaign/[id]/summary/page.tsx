"use client";

import { useCampaign } from "@/lib/campaignContext";
import PageScaffold, { PhaseNote } from "@/components/PageScaffold";

export default function SummaryPage() {
  const { campaign, accepted, total, escalationCount } = useCampaign();
  const done = campaign?.status === "completed" || campaign?.status === "failed";

  return (
    <PageScaffold title="Summary" sub="Post-run report and publishing.">
      <PhaseNote>
        <p className="mb-2 text-foreman-ink">
          The report (mono tally line, what-changed figures, outcome-by-batch bars, apply/PR cards)
          is built in Phase 5 (mock: <span className="font-mono">summary.html</span>).
        </p>
        <p>
          {done ? (
            <>
              Campaign {campaign?.status}:{" "}
              <span className="font-mono tabular-nums text-foreman-ink">{accepted}</span> accepted,{" "}
              <span className="font-mono tabular-nums text-foreman-ink">{escalationCount}</span>{" "}
              escalated of{" "}
              <span className="font-mono tabular-nums text-foreman-ink">{total}</span>.
            </>
          ) : (
            <>The report fills in once the campaign reaches a terminal state.</>
          )}
        </p>
      </PhaseNote>
    </PageScaffold>
  );
}
