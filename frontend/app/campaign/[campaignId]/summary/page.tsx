"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { readSeamQueue, writeSeamQueue } from "@/lib/seamQueue";
import type { Campaign, SeamQueue } from "@/lib/types";
import CampaignSummaryChart from "@/components/CampaignSummaryChart";
import CompletionPanel from "@/components/CompletionPanel";
import UnitStatusTable, { type UnitView } from "@/components/UnitStatusTable";
import UnitPreviewPanel from "@/components/UnitPreviewPanel";
import DiffView from "@/components/DiffView";

export default function CampaignSummaryPage() {
  const params = useParams<{ campaignId: string }>();
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selectedView, setSelectedView] = useState<UnitView>(null);
  const [seamQueue, setSeamQueue] = useState<SeamQueue | null>(null);
  const [startingNext, setStartingNext] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);

  useEffect(() => {
    api.getCampaign(params.campaignId).then(setCampaign).catch(() => setCampaign(null));
    setSeamQueue(readSeamQueue());
  }, [params.campaignId]);

  // Approved seams execute one campaign at a time: when this campaign is
  // done, the next approved seam from the discovery queue can start.
  async function handleStartNextSeam() {
    if (!seamQueue || seamQueue.seams.length === 0) return;
    setStartingNext(true);
    setNextError(null);
    const [next, ...rest] = seamQueue.seams;
    try {
      const created = await api.createCampaign(next.seamId);
      writeSeamQueue({ ...seamQueue, seams: rest });
      router.push(`/campaign/${created.campaignId}?repoId=${seamQueue.repoId}`);
    } catch (err) {
      setNextError(err instanceof ApiError ? err.message : String(err));
      setStartingNext(false);
    }
  }

  if (!campaign) {
    return <p className="text-sm text-slate-500">Loading campaign summary…</p>;
  }

  const passedUnits = campaign.units.filter((unit) => unit.status === "passed");
  const escalatedUnits = campaign.units.filter((unit) => unit.status === "escalated");

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {seamQueue && seamQueue.seams.length > 0 && (
        <section className="rounded-lg border border-blue-900 bg-blue-950/40 p-4 space-y-2">
          <p className="text-sm text-slate-200">
            <span className="font-semibold">{seamQueue.seams.length}</span> approved
            seam(s) still queued from discovery. Next:{" "}
            <span className="font-medium">{seamQueue.seams[0].title}</span>
          </p>
          <button
            type="button"
            onClick={handleStartNextSeam}
            disabled={startingNext}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {startingNext ? "Starting…" : "Start next seam campaign"}
          </button>
          {nextError && <p className="text-sm text-red-400">{nextError}</p>}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Campaign summary — {params.campaignId.slice(0, 8)}
        </h2>
        <CampaignSummaryChart units={campaign.units} />
        <UnitStatusTable
          units={campaign.units}
          selected={selectedView}
          onSelect={setSelectedView}
        />
      </section>

      {selectedView && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {selectedView.view === "preview" ? "Live preview" : "Unit diff"}
          </h2>
          {selectedView.view === "preview" ? (
            <UnitPreviewPanel campaignId={params.campaignId} unitId={selectedView.unitId} />
          ) : (
            (() => {
              const unit = campaign.units.find(
                (candidate) => candidate.unitId === selectedView.unitId
              );
              return unit?.diff ? (
                <DiffView diff={unit.diff} />
              ) : (
                <p className="text-xs text-slate-600">No diff recorded for this unit.</p>
              );
            })()
          )}
        </section>
      )}

      {campaign.status === "completed" ? (
        <CompletionPanel
          campaignId={params.campaignId}
          passedUnits={passedUnits.length}
          escalatedUnits={escalatedUnits.length}
        />
      ) : (
        <p className="text-sm text-slate-500">
          Campaign status is &quot;{campaign.status}&quot; — publishing options appear
          once the campaign completes.
        </p>
      )}
      {passedUnits.length + escalatedUnits.length === 0 && (
        <p className="text-sm text-slate-500">No accepted or escalated units.</p>
      )}
    </div>
  );
}
