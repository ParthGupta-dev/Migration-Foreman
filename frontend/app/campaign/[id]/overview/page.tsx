"use client";

import { useCampaign } from "@/lib/campaignContext";
import PageScaffold, { PhaseNote } from "@/components/PageScaffold";

export default function OverviewPage() {
  const { campaign, accepted, total, connected, usingPolling } = useCampaign();

  return (
    <PageScaffold title="Overview" sub="Live pipeline flow scene.">
      <PhaseNote>
        <p className="mb-2 text-foreman-ink">
          The isometric flow scene is built in Phase 6 (`components/FlowScene.tsx`, mock:{" "}
          <span className="font-mono">overview.html</span>).
        </p>
        <p>
          Shell is live: campaign{" "}
          <span className="font-mono text-foreman-ink">{campaign?.status ?? "loading"}</span>,{" "}
          <span className="font-mono tabular-nums text-foreman-ink">
            {accepted}/{total}
          </span>{" "}
          accepted · transport{" "}
          <span className="font-mono text-foreman-ink">
            {connected ? "websocket" : usingPolling ? "polling" : "connecting"}
          </span>
          .
        </p>
      </PhaseNote>
    </PageScaffold>
  );
}
