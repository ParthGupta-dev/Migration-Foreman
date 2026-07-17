"use client";

// The batch board (mock: batches.html `.bboard`). An auto-fill grid of tiles,
// sorted attention-first (escalated → retrying → running → queued → accepted).

import type { Batch } from "@/lib/batches";
import { sortBatchesForBoard } from "@/lib/batches";
import BatchTile from "./BatchTile";

export default function BatchBoard({
  batches,
  selectedId,
  onOpen,
}: {
  batches: Batch[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const ordered = sortBatchesForBoard(batches);

  return (
    <div className="mb-7 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {ordered.map((batch) => (
        <BatchTile
          key={batch.id}
          batch={batch}
          selected={batch.id === selectedId}
          onOpen={() => onOpen(batch.id)}
        />
      ))}
    </div>
  );
}
