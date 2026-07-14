"use client";

// Full-width batch detail below the board (mock: batches.html `.bdetail`).
// Header (dot · name · id · pill · Discuss-in-chat for escalations), a sub line,
// then one FileCard per non-blocked unit in the batch.

import Link from "next/link";
import type { Batch } from "@/lib/batches";
import { activeUnits, batchCounts, batchStatus } from "@/lib/batches";
import FileCard from "./FileCard";
import { BATCH_PILL } from "./format";

export default function BatchDetail({
  batch,
  campaignId,
}: {
  batch: Batch;
  campaignId: string;
}) {
  const status = batchStatus(batch.units);
  const pill = BATCH_PILL[status];
  const files = activeUnits(batch.units);
  const escalated = status === "escalated";

  return (
    <>
      <div className="mb-1 flex items-center gap-3">
        <span className="h-3.5 w-3.5 flex-none rounded-[3px]" style={{ background: batch.color }} />
        <h2 className="text-base font-bold">
          {batch.label}{" "}
          <span className="font-mono text-xs font-normal text-foreman-faint">{batch.id}</span>
        </h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${pill.cls}`}>
          <span className={`h-2 w-2 rounded-full ${pill.lamp} ${pill.pulse ? "pulse" : ""}`} />
          {pill.label}
        </span>
        {escalated && (
          <Link
            href={`/campaign/${campaignId}/chat?ref=${batch.id}`}
            className="ml-auto inline-flex items-center gap-2 rounded-ctl border border-transparent bg-foreman-fail px-3 py-[5px] text-[13px] font-semibold text-white no-underline hover:bg-[#9A4E3C]"
          >
            Discuss in chat →
          </Link>
        )}
      </div>

      <p className="mb-4 text-[13px] text-foreman-dim">
        {batchCounts(batch.units)}
        {escalated && " · the retry loop is exhausted — this one needs you"}
      </p>

      <div className="flex flex-col gap-4">
        {files.map((unit) => (
          <FileCard key={unit.unitId} unit={unit} campaignId={campaignId} />
        ))}
      </div>
    </>
  );
}
