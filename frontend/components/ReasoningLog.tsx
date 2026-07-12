"use client";

import { useEffect, useRef } from "react";
import type { ReasoningLine } from "@/hooks/useCampaignSocket";

export default function ReasoningLog({ lines }: { lines: ReasoningLine[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div className="border border-slate-800 rounded-lg bg-black/40 h-64 overflow-y-auto p-3 font-mono text-xs space-y-1">
      {lines.length === 0 && (
        <p className="text-slate-500">Waiting for agent reasoning…</p>
      )}
      {lines.map((line, index) => (
        <p key={index} className="text-slate-300">
          <span className="text-slate-500">[{line.unitId.slice(0, 8)}]</span>{" "}
          {line.text}
        </p>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
