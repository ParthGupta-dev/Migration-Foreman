"use client";

// Batches page (frontend_refactor.md Phase 4, mock: design/mocks/batches.html).
// The board of batch tiles (sorted attention-first) over a full-width detail
// panel, plus a separate strip for blocked/infra-failure units. Deep links:
// `?open=B-xx` opens a batch on load; opening a batch reflects into the URL so
// the view is shareable. Everything is wired to the shared CampaignProvider.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "@/lib/campaignContext";
import { activeUnits, isBlockedStatus } from "@/lib/batches";
import BatchBoard from "@/components/batches/BatchBoard";
import BatchDetail from "@/components/batches/BatchDetail";
import BlockedStrip from "@/components/batches/BlockedStrip";

export default function BatchesPage() {
  const { batches, campaign, campaignId } = useCampaign();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  // Only batches with at least one non-blocked unit get a tile; all-blocked
  // batches live entirely in the strip below.
  const boardBatches = useMemo(
    () => batches.filter((b) => activeUnits(b.units).length > 0),
    [batches]
  );
  const blockedUnits = useMemo(
    () => (campaign?.units ?? []).filter((u) => isBlockedStatus(u.status)),
    [campaign]
  );
  const selectedBatch = useMemo(
    () => boardBatches.find((b) => b.id === selectedId) ?? null,
    [boardBatches, selectedId]
  );

  // Deep link in: read ?open=B-xx once after mount (avoids useSearchParams'
  // Suspense requirement and matches the mock's own location.search read).
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) setSelectedId(open);
  }, []);

  const openBatch = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("open", id);
    window.history.replaceState(null, "", url);
  }, []);

  // Scroll the detail into view + focus it when a (real) batch opens, mirroring
  // the mock's openBatch behaviour.
  useEffect(() => {
    if (!selectedBatch || !detailRef.current) return;
    detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    detailRef.current.focus({ preventScroll: true });
  }, [selectedBatch]);

  return (
    <div className="p-8" style={{ maxWidth: 1160 }}>
      <div className="mb-5 flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-[-0.01em]">Batches</h1>
        <span className="ml-auto text-xs text-foreman-dim">
          click a batch for every diff, test result and attempt · sorted: escalated → retrying →
          running → accepted
        </span>
      </div>

      {boardBatches.length === 0 && blockedUnits.length === 0 ? (
        <div className="rounded-card border border-dashed border-[#D6C9B5] bg-foreman-card p-12 text-center text-foreman-dim">
          <p className="mb-1 text-[15px] font-semibold text-foreman-ink">No units yet</p>
          <p className="text-[13px]">
            {campaign ? "This campaign has no files in scope." : "Connecting to the campaign…"}
          </p>
        </div>
      ) : (
        <>
          <BatchBoard batches={boardBatches} selectedId={selectedId} onOpen={openBatch} />

          <BlockedStrip units={blockedUnits} campaignId={campaignId} />

          <section ref={detailRef} tabIndex={-1} className="outline-none">
            {selectedBatch && <BatchDetail batch={selectedBatch} campaignId={campaignId} />}
          </section>
        </>
      )}
    </div>
  );
}
