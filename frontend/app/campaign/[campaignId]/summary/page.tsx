"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import type { Campaign, FinalizeResult } from "@/lib/types";
import CampaignSummaryChart from "@/components/CampaignSummaryChart";
import UnitStatusTable, { type UnitView } from "@/components/UnitStatusTable";
import UnitPreviewPanel from "@/components/UnitPreviewPanel";
import DiffView from "@/components/DiffView";

export default function CampaignSummaryPage() {
  const params = useParams<{ campaignId: string }>();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<UnitView>(null);

  useEffect(() => {
    api.getCampaign(params.campaignId).then(setCampaign).catch(() => setCampaign(null));
  }, [params.campaignId]);

  async function handleFinalize() {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const result = await api.finalizeCampaign(params.campaignId);
      setFinalizeResult(result);
    } catch (err) {
      // PROJECT.md section 11 fallback: PR creation failure -> show the
      // aggregated diffs directly in this view (already rendered below).
      setFinalizeError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setFinalizing(false);
    }
  }

  if (!campaign) {
    return <p className="text-sm text-slate-500">Loading campaign summary…</p>;
  }

  const acceptedOrEscalated = campaign.units.filter(
    (unit) => unit.status === "passed" || unit.status === "escalated"
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Pull request
        </h2>
        {finalizeResult ? (
          <p className="text-sm">
            <a
              href={finalizeResult.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 underline"
            >
              {finalizeResult.prUrl}
            </a>{" "}
            <span className="text-slate-500">
              ({finalizeResult.acceptedUnits} accepted, {finalizeResult.escalatedUnits} escalated)
            </span>
          </p>
        ) : (
          <button
            type="button"
            onClick={handleFinalize}
            disabled={finalizing || campaign.status !== "completed"}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-40"
          >
            {finalizing ? "Opening PR…" : "Finalize & open PR"}
          </button>
        )}
        {finalizeError && (
          <p className="text-sm text-red-400">
            PR creation failed ({finalizeError}) — use View Diff / Live Preview on the
            units above to inspect the changes instead.
          </p>
        )}
        {acceptedOrEscalated.length === 0 && (
          <p className="text-sm text-slate-500">No accepted or escalated units.</p>
        )}
      </section>
    </div>
  );
}
