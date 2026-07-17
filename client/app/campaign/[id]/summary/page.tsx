"use client";

// Summary page (frontend_refactor.md Phase 5, mock: design/mocks/summary.html).
// The peak-end report: a mono tally line, a figures row, outcome-by-batch bars
// (pure CSS, no chart library), a per-unit table, the publishing cards (Apply
// locally / PR) and a follow-up card linking to the escalated batches. Numbers
// are real: figures from GET /campaign/{id} units + diffs, duration from
// createdAt/completedAt (gap G5 now live). A queued next seam starts from here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCampaign } from "@/lib/campaignContext";
import { api } from "@/lib/api";
import { batchOutcome, sortUnits, type Batch } from "@/lib/batches";
import { fileVisual, FILE_LAMP, statusWord } from "@/components/batches/format";
import { diffLineCounts, duration } from "@/lib/format";
import { readSeamQueue, writeSeamQueue } from "@/lib/seamQueue";
import Publish from "@/components/summary/Publish";
import type { Unit } from "@/lib/types";

export default function SummaryPage() {
  const { campaign, stored, batches, campaignId } = useCampaign();

  const units = useMemo(() => campaign?.units ?? [], [campaign]);
  const total = units.length;
  const accepted = units.filter((u) => u.status === "passed").length;
  const escalated = units.filter((u) => u.status === "escalated").length;
  const retriesCaught = units.filter((u) => u.status === "passed" && u.attempt > 1).length;
  const { added, removed } = useMemo(
    () => diffLineCounts(units.filter((u) => u.status === "passed").map((u) => u.diff)),
    [units]
  );
  const dur = duration(campaign?.createdAt ?? stored?.startedAt, campaign?.completedAt ?? stored?.completedAt);
  const escalatedBatch = useMemo(() => firstEscalatedBatch(batches), [batches]);

  if (!campaign) {
    return (
      <div className="p-8" style={{ maxWidth: 1200 }}>
        <h1 className="mb-1 text-lg font-bold tracking-[-0.01em]">Summary</h1>
        <p className="text-[13px] text-foreman-dim">Connecting to the campaign…</p>
      </div>
    );
  }

  const running = campaign.status === "running";
  const title = stored?.title ?? (campaign.seam ? `${campaign.seam.beforePattern} → ${campaign.seam.afterPattern}` : campaignId.slice(0, 8));

  return (
    <div className="p-8" style={{ maxWidth: 1200 }}>
      {/* peak-end tally */}
      <p className="pb-2 pt-6 font-mono text-[22px] leading-[1.5] tabular-nums">
        <strong className="font-medium">
          {accepted}/{total}
        </strong>{" "}
        units migrated and verified autonomously
        <span className="px-2 text-foreman-queued">·</span>
        <strong className="font-medium">{escalated}</strong> escalated
        <span className="px-2 text-foreman-queued">·</span>
        <strong className="font-medium">{dur}</strong>
      </p>
      <p className="mb-8 text-[13px] text-foreman-dim">
        {title}
        {stored?.repoUrl ? ` · ${stored.repoUrl.split("/").slice(-1)[0]}` : ""}
        {campaign.completedAt ? ` · finished ${new Date(campaign.completedAt).toLocaleTimeString("en-GB", { hour12: false })}` : running ? " · in progress" : ""}
        {" · every accepted unit passed "}
        <span className="font-mono">{campaign.testCommand}</span> in its own worktree
      </p>

      {/* figures */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Fig num={String(accepted)} label="files changed" />
        <Fig num={`+${added} −${removed}`} label="lines — a pure call-site swap" />
        <Fig num={String(retriesCaught)} label="failures caught & retried by the gate" />
        <Fig num={String(escalated)} label="escalated for human review" hot={escalated > 0} />
      </div>

      {/* replay */}
      <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card px-6 py-4 shadow-card">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm font-semibold">Watch it back</p>
            <p className="text-xs text-foreman-dim">
              Replay the whole run in the Overview scene — every dispatch, retry and escalation in
              order.
            </p>
          </div>
          <Link
            href={`/campaign/${campaignId}/overview?replay=1`}
            className="ml-auto whitespace-nowrap rounded-ctl border border-[#D6C9B5] bg-foreman-card px-4 py-2 text-sm font-semibold text-foreman-ink no-underline hover:bg-foreman-bg"
          >
            ▶ Replay in Overview
          </Link>
        </div>
      </section>

      {/* outcome by batch */}
      <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">
          Outcome by batch
        </h2>
        {batches.map((b) => (
          <OutcomeBar key={b.id} batch={b} />
        ))}
      </section>

      {/* PR + apply publishing */}
      <Publish campaignId={campaignId} />

      {/* follow-up */}
      {escalatedBatch && (
        <section className="mt-4 rounded-card border border-[#D9A99A] bg-foreman-card px-6 py-4 shadow-card">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">
            Needs follow-up
          </h2>
          <div className="flex items-center gap-4">
            <span className="h-2 w-2 flex-none rounded-full bg-foreman-fail" />
            <span className="font-mono text-[13px]">
              {batchEscalatedUnits(escalatedBatch)
                .map((u) => u.scopeGlob)
                .join(", ")}
            </span>
            <span className="text-xs text-foreman-dim">retry loop exhausted — needs a human</span>
            <Link
              href={`/campaign/${campaignId}/batches?open=${escalatedBatch.id}`}
              className="ml-auto whitespace-nowrap rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-[5px] text-[13px] font-semibold text-foreman-ink no-underline hover:bg-foreman-bg"
            >
              Open batch
            </Link>
          </div>
        </section>
      )}

      {/* per-unit table */}
      <section className="mt-4 overflow-hidden rounded-card border border-foreman-line bg-foreman-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Scope</Th>
                <Th>Result</Th>
                <Th>Rounds</Th>
              </tr>
            </thead>
            <tbody>
              {batches.flatMap((b) =>
                sortUnits(b.units).map((u) => (
                  <tr key={u.unitId} className="border-b border-foreman-line last:border-b-0">
                    <Td>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle" style={{ background: b.color }} />
                      {b.label}
                    </Td>
                    <Td mono>{u.scopeGlob}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${FILE_LAMP[fileVisual(u.status)].cls}`} />
                        <span className="text-xs">{statusWord(u.status)}</span>
                      </span>
                    </Td>
                    <Td mono>{u.attempt}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* start next queued seam */}
      <NextSeam campaignId={campaignId} />
    </div>
  );
}

function NextSeam({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [queue] = useState(() => (typeof window !== "undefined" ? readSeamQueue() : null));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!queue || queue.seams.length === 0) return null;
  const next = queue.seams[0];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const created = await api.createCampaign(next.seamId);
      writeSeamQueue({ ...queue!, seams: queue!.seams.slice(1) });
      router.push(`/campaign/${created.campaignId}/overview`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the next seam.");
      setStarting(false);
    }
  }

  return (
    <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card px-6 py-4 shadow-card">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">
        Next in the queue ({queue.seams.length})
      </h2>
      <div className="flex items-center gap-4">
        <span className="font-mono text-[13px]">{next.title}</span>
        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="ml-auto whitespace-nowrap rounded-ctl bg-foreman-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-60"
        >
          {starting ? "Starting…" : "Start next seam campaign →"}
        </button>
      </div>
      {error && <p className="mt-3 text-xs text-foreman-fail-text">{error}</p>}
    </section>
  );
}

function OutcomeBar({ batch }: { batch: Batch }) {
  const o = batchOutcome(batch.units);
  const pct = (n: number) => (o.total ? (n / o.total) * 100 : 0);
  const note = o.escalated > 0 || o.blocked > 0
    ? `${o.accepted}/${o.total} · ${o.escalated + o.blocked} ${o.escalated + o.blocked === 1 ? "escalated" : "escalated"}`
    : o.running > 0
      ? `${o.accepted}/${o.total} · ${o.running} in flight`
      : `${o.accepted}/${o.total} accepted`;

  return (
    <div className="grid grid-cols-[130px_1fr_120px] items-center gap-4 py-[9px]">
      <span className="flex items-center gap-2.5 text-[13px] font-semibold">
        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: batch.color }} />
        {batch.label}
      </span>
      <span className="flex h-2 overflow-hidden rounded-full bg-foreman-queued-bg">
        <span className="h-full" style={{ width: `${pct(o.accepted)}%`, background: batch.color }} />
        <span className="h-full bg-foreman-fail" style={{ width: `${pct(o.escalated + o.blocked)}%` }} />
        <span className="h-full bg-foreman-retry" style={{ width: `${pct(o.running)}%` }} />
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-foreman-dim">{note}</span>
    </div>
  );
}

function Fig({ num, label, hot }: { num: string; label: string; hot?: boolean }) {
  return (
    <div className="rounded-card border border-foreman-line bg-foreman-card px-5 py-4 shadow-card">
      <div className={`text-2xl font-bold tracking-[-0.02em] tabular-nums ${hot ? "text-foreman-fail-text" : ""}`}>
        {num}
      </div>
      <div className="mt-0.5 text-xs text-foreman-dim">{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-foreman-line bg-[#F5F0E8] px-5 py-2.5 text-left text-xs font-semibold text-foreman-dim">
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-5 py-2.5 text-[13px] ${mono ? "font-mono tabular-nums" : ""}`}>{children}</td>;
}

function firstEscalatedBatch(batches: Batch[]): Batch | null {
  return batches.find((b) => b.units.some((u) => u.status === "escalated")) ?? null;
}

function batchEscalatedUnits(batch: Batch): Unit[] {
  return batch.units.filter((u) => u.status === "escalated");
}
