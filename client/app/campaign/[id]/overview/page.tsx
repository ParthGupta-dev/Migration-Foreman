"use client";

// Overview page (frontend_refactor.md Phase 6, mock: design/mocks/overview.html).
// The flow scene bound to live campaign state via the shared CampaignProvider,
// a compact KPI strip, a batch colour legend and a caption. Finished campaigns
// can replay the real run: GET /campaign/{id}/events (gap G4 now live) is
// stepped through in order so tokens move through the same zones event-accurate
// rather than from final states only. Token clicks deep-link to the batch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCampaign } from "@/lib/campaignContext";
import { api } from "@/lib/api";
import { duration } from "@/lib/format";
import FlowScene from "@/components/overview/FlowScene";
import type { Unit, UnitStatus } from "@/lib/types";

export default function OverviewPage() {
  const { campaign, batches, stored, campaignId, accepted, total, escalationCount } = useCampaign();
  const router = useRouter();

  const [replayUnits, setReplayUnits] = useState<Unit[] | null>(null);
  const [replaying, setReplaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const liveUnits = campaign?.units ?? [];
  const finished = campaign?.status === "completed" || campaign?.status === "failed";

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const startReplay = useCallback(async () => {
    if (!campaign) return;
    clearTimers();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let events;
    try {
      events = (await api.getCampaignEvents(campaignId, 1000, 0)).events;
    } catch {
      return;
    }
    const base = new Map<string, Unit>(
      campaign.units.map((u) => [u.unitId, { ...u, status: "pending" as UnitStatus, attempt: 0, diff: null, failureLog: null }])
    );
    const steps = events.filter((e) => e.eventType === "status_change" && e.metadata?.status);

    if (reduced) {
      // No motion: jump straight to the final state.
      setReplayUnits(campaign.units);
      setReplaying(false);
      return;
    }

    setReplayUnits([...base.values()]);
    setReplaying(true);
    const gap = Math.min(700, Math.max(180, 9000 / Math.max(1, steps.length)));
    steps.forEach((ev, i) => {
      const t = setTimeout(() => {
        const u = base.get(ev.unitId);
        if (u) {
          u.status = ev.metadata!.status as UnitStatus;
          u.attempt = (ev.metadata!.attempt as number) ?? u.attempt;
        }
        setReplayUnits([...base.values()]);
        if (i === steps.length - 1) setReplaying(false);
      }, (i + 1) * gap);
      timers.current.push(t);
    });
  }, [campaign, campaignId, clearTimers]);

  // Auto-start replay when arriving with ?replay=1 (from the Summary page).
  useEffect(() => {
    if (!campaign || !finished) return;
    const wants = new URLSearchParams(window.location.search).get("replay") === "1";
    if (wants) startReplay();
    return clearTimers;
  }, [campaign, finished, startReplay, clearTimers]);

  const units = replayUnits ?? liveUnits;

  // KPIs derived from whichever unit set is showing.
  const shownAccepted = replayUnits ? replayUnits.filter((u) => u.status === "passed").length : accepted;
  const shownEsc = replayUnits ? replayUnits.filter((u) => u.status === "escalated").length : escalationCount;
  const onBench = units.filter((u) => u.status === "running" || u.status === "retrying").length;
  const elapsed = duration(campaign?.createdAt ?? stored?.startedAt, finished ? campaign?.completedAt ?? stored?.completedAt : null);
  const pct = total > 0 ? Math.round((shownAccepted / total) * 100) : 0;

  const idle = total === 0;
  const caption = useMemo(
    () => captionFor({ idle, replaying, finished, accepted: shownAccepted, total, onBench, escalated: shownEsc }),
    [idle, replaying, finished, shownAccepted, total, onBench, shownEsc]
  );

  const openBatch = useCallback(
    (batchId: string) => {
      if (batchId) router.push(`/campaign/${campaignId}/batches?open=${batchId}`);
    },
    [router, campaignId]
  );

  return (
    <div className="p-8" style={{ maxWidth: 1240 }}>
      <FlowScene units={units} batches={batches} onTokenClick={openBatch} />

      <p
        className="mt-3 text-center text-sm text-foreman-dim [&_strong]:font-semibold [&_strong]:tabular-nums [&_strong]:text-foreman-ink"
        dangerouslySetInnerHTML={{ __html: caption }}
      />

      {batches.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-3.5 border-t border-foreman-line pt-3">
          {batches.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5 text-[11px] text-foreman-dim">
              <i className="h-[11px] w-[11px] rounded-[3px]" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi num={`${shownAccepted}/${total || 0}`} label="Accepted" sub={idle ? "not started" : `${pct}% complete`} />
        <Kpi num={String(onBench)} label="On the bench" sub="in worktrees" />
        <Kpi num={String(shownEsc)} label="Escalated" sub="needs review" hot={shownEsc > 0} />
        <Kpi num={elapsed} label="Elapsed" sub={finished ? "done" : "running"} />
      </div>

      {finished && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={startReplay}
            disabled={replaying}
            className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-4 py-2 text-sm font-semibold text-foreman-ink hover:bg-foreman-bg disabled:opacity-60"
          >
            {replaying ? "Replaying…" : "▶ Replay the run"}
          </button>
          {replayUnits && !replaying && (
            <button
              type="button"
              onClick={() => setReplayUnits(null)}
              className="text-[13px] text-foreman-link hover:underline"
            >
              show live state
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-foreman-dim">
        Blocks are coloured by <strong className="font-semibold">batch</strong>. Status shows as the
        floating badge and which zone the block sits in — queued in the yard, on the bench, shipped
        to the dock, or parked on the review siding. Click a block to open its batch.
      </p>
    </div>
  );
}

function Kpi({ num, label, sub, hot }: { num: string; label: string; sub: string; hot?: boolean }) {
  return (
    <div className="rounded-card border border-foreman-line bg-foreman-card px-4 py-3.5 shadow-card">
      <div className={`text-[26px] font-semibold leading-[1.1] tabular-nums ${hot ? "text-foreman-fail" : "text-foreman-ink"}`}>
        {num}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreman-dim">{label}</div>
      <div className="mt-0.5 text-xs text-foreman-faint">{sub}</div>
    </div>
  );
}

function captionFor(s: {
  idle: boolean;
  replaying: boolean;
  finished: boolean;
  accepted: number;
  total: number;
  onBench: number;
  escalated: number;
}): string {
  if (s.idle)
    return "Foreman groups the in-scope files into <strong>batches</strong>, then runs each unit through the bench — hammering, testing, polishing — and only ships what passes the gate.";
  if (s.replaying) return `Replaying the run — <strong>${s.accepted}/${s.total}</strong> accepted so far`;
  if (s.finished)
    return `<strong>${s.accepted}/${s.total}</strong> units migrated and verified autonomously · <strong>${s.escalated}</strong> escalated`;
  return `<strong>${s.accepted}/${s.total}</strong> accepted · ${s.onBench} on the bench${s.escalated ? ` · ${s.escalated} on the review siding` : ""}`;
}
