"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCampaignSocket } from "@/hooks/useCampaignSocket";
import { api } from "@/lib/api";
import type { GraphResponse } from "@/lib/types";
import DependencyGraph from "@/components/DependencyGraph";
import UnitStatusTable, { type UnitView } from "@/components/UnitStatusTable";
import UnitPreviewPanel from "@/components/UnitPreviewPanel";
import DiffView from "@/components/DiffView";
import ReasoningLog from "@/components/ReasoningLog";
import EscalationPanel from "@/components/EscalationPanel";
import { unitStatusNodeColor } from "@/utils/formatUnitStatus";

export default function LiveCampaignPage() {
  const params = useParams<{ campaignId: string }>();
  const searchParams = useSearchParams();
  const repoId = searchParams.get("repoId");
  const router = useRouter();

  const { campaign, connected, usingPolling, reasoningLog, error } =
    useCampaignSocket(params.campaignId);

  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [selectedView, setSelectedView] = useState<UnitView>(null);

  useEffect(() => {
    if (!repoId) return;
    api
      .getGraph(repoId)
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [repoId]);

  useEffect(() => {
    if (campaign?.status === "completed" || campaign?.status === "failed") {
      router.push(`/campaign/${params.campaignId}/summary`);
    }
  }, [campaign?.status, params.campaignId, router]);

  const statusById = new Map(
    campaign?.units.map((unit) => [unit.scopeGlob, unit.status]) ?? []
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Live campaign — {params.campaignId.slice(0, 8)}
        </h2>
        <span
          className={`text-xs font-medium ${
            connected ? "text-green-400" : "text-amber-400"
          }`}
        >
          {connected ? "● live (WebSocket)" : usingPolling ? "● polling fallback" : "● connecting…"}
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!campaign ? (
        <p className="text-sm text-slate-500">Loading campaign…</p>
      ) : (
        <>
          {graph ? (
            <DependencyGraph
              nodes={graph.nodes}
              edges={graph.edges}
              colorForNode={(id) => {
                const status = statusById.get(id);
                return status ? unitStatusNodeColor(status) : undefined;
              }}
            />
          ) : (
            <p className="text-xs text-slate-600">
              No dependency graph available for this campaign — showing the unit table only.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Units
              </h3>
              <UnitStatusTable
                units={campaign.units}
                selected={selectedView}
                onSelect={setSelectedView}
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agent reasoning
              </h3>
              <ReasoningLog lines={reasoningLog} />
            </div>
          </div>

          {selectedView && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selectedView.view === "preview" ? "Live preview" : "Unit diff"}
              </h3>
              {selectedView.view === "preview" ? (
                <UnitPreviewPanel
                  campaignId={params.campaignId}
                  unitId={selectedView.unitId}
                />
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
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Escalations
            </h3>
            <EscalationPanel units={campaign.units} />
          </div>
        </>
      )}
    </div>
  );
}
