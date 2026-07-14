"use client";

// A single batch tile on the board (mock: batches.html `.btile`). Category dot,
// name + id, status pill, counts line, and — for the attention statuses — a
// reason/round line with a tinted card.

import type { Batch } from "@/lib/batches";
import { batchCounts, batchReason, batchStatus } from "@/lib/batches";
import { BATCH_PILL, BATCH_TILE_TINT } from "./format";

export default function BatchTile({
  batch,
  selected,
  onOpen,
}: {
  batch: Batch;
  selected: boolean;
  onOpen: () => void;
}) {
  const status = batchStatus(batch.units);
  const pill = BATCH_PILL[status];
  const tint = BATCH_TILE_TINT[status] ?? "border-foreman-line";
  const reason = batchReason(batch.units, status);

  return (
    <button
      type="button"
      data-b={batch.id}
      onClick={onOpen}
      className={`flex flex-col gap-[9px] rounded-card border bg-foreman-card p-4 px-5 text-left shadow-card hover:border-foreman-faint ${tint} ${
        selected ? "!border-foreman-primary" : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: batch.color }} />
        <span className="text-sm font-semibold">{batch.label}</span>
        <span className="font-mono text-[11px] text-foreman-faint">{batch.id}</span>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.cls}`}>
          <span className={`h-2 w-2 rounded-full ${pill.lamp} ${pill.pulse ? "pulse" : ""}`} />
          {pill.label}
        </span>
      </div>

      <div className="flex gap-3.5 font-mono text-xs tabular-nums text-foreman-dim">{batchCounts(batch.units)}</div>

      {status === "escalated" && reason && (
        <div className="font-mono text-xs font-semibold text-foreman-fail-text">{reason}</div>
      )}
      {status === "retrying" && reason && (
        <div className="font-mono text-xs font-semibold text-foreman-retry-text">{reason}</div>
      )}
    </button>
  );
}
