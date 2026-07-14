"use client";

import { useCampaign } from "@/lib/campaignContext";
import PageScaffold, { PhaseNote } from "@/components/PageScaffold";

export default function LogPage() {
  const { reasoningLog } = useCampaign();

  return (
    <PageScaffold title="Log" sub="Terminal-style live tail of the campaign.">
      <PhaseNote>
        <p className="mb-2 text-foreman-ink">
          The terminal log (the one dark surface — verb colors, batch hues, blinking tail) is built
          in Phase 5 (mock: <span className="font-mono">log.html</span>).
        </p>
        <p>
          Shared socket buffer:{" "}
          <span className="font-mono tabular-nums text-foreman-ink">{reasoningLog.length}</span>{" "}
          reasoning {reasoningLog.length === 1 ? "line" : "lines"} captured so far.
        </p>
      </PhaseNote>
    </PageScaffold>
  );
}
