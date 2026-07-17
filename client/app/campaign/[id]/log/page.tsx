"use client";

// Log page (frontend_refactor.md Phase 5, mock: design/mocks/log.html). The one
// dark surface in the light shell: a terminal feed of the real unit_events
// history (GET /campaign/{id}/events, gap G4 now live), re-fetched on an
// interval while the campaign is running so it reads as a live tail. Verb
// filter chips + a batch select filter the accumulated buffer client-side;
// auto-scroll sticks to the bottom unless the pointer is over the feed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "@/lib/campaignContext";
import { api } from "@/lib/api";
import { eventsToLogLines, VERB_FILTERS, VERB_TONE, type LogLine, type LogVerb } from "@/lib/logLines";
import type { CampaignEvent } from "@/lib/types";

export default function LogPage() {
  const { campaignId, campaign, batches } = useCampaign();
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [verb, setVerb] = useState<LogVerb | "all">("all");
  const [batchFilter, setBatchFilter] = useState<string>("all");

  const feedRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);
  const running = campaign?.status === "running" || campaign?.status === undefined;

  // Load real event history on mount; while running, re-fetch so the feed
  // tails live (events are the authoritative, ordered source — simpler and
  // more accurate than reconciling WS deltas).
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .getCampaignEvents(campaignId, 1000, 0)
        .then((r) => alive && setEvents(r.events))
        .catch(() => {});
    };
    load();
    if (!running) return () => { alive = false; };
    const handle = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [campaignId, running]);

  const lines = useMemo(() => eventsToLogLines(events, batches), [events, batches]);
  const visible = useMemo(
    () =>
      lines.filter(
        (l) =>
          (verb === "all" || l.verb === verb) &&
          (batchFilter === "all" || l.batchLabel === batchFilter)
      ),
    [lines, verb, batchFilter]
  );

  // Auto-scroll to bottom on new lines, unless the pointer is parked over the
  // feed (scroll-lock-on-hover, mock behaviour).
  useEffect(() => {
    if (hoverRef.current || !feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [visible.length]);

  const accepted = (campaign?.units ?? []).filter((u) => u.status === "passed").length;
  const total = campaign?.units.length ?? 0;
  const batchOptions = useMemo(() => batches.map((b) => b.label), [batches]);

  return (
    <div className="p-8" style={{ maxWidth: 1080 }}>
      <h1 className="mb-1 text-lg font-bold tracking-[-0.01em]">Log</h1>
      <p className="mb-6 text-[13px] text-foreman-dim">
        Everything the foreman does, as it happens — status changes and reasoning, merged from the
        live socket and the persisted event history.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Chip active={verb === "all"} onClick={() => setVerb("all")}>
          all
        </Chip>
        {VERB_FILTERS.map((f) => (
          <Chip key={f.key} active={verb === f.key} onClick={() => setVerb(f.key)}>
            {f.label}
          </Chip>
        ))}
        <select
          aria-label="Filter by batch"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          className="ml-auto w-[150px] rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-sm"
        >
          <option value="all">all batches</option>
          {batchOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-card border border-[#2E2820] bg-[#1B1713] shadow-card">
        <div className="flex items-center gap-2.5 border-b border-[#2E2820] px-5 py-2.5 font-mono text-[11px] text-[#8A8072]">
          <span className={running ? "text-[#96B577]" : "text-[#857B6B]"}>●</span>
          <span>
            foreman · campaign {campaignId.slice(0, 8)} · {running ? "live tail" : "event history"}
          </span>
          <span className="ml-auto tabular-nums">{total > 0 ? `${accepted}/${total} accepted` : "—"}</span>
        </div>

        <div
          ref={feedRef}
          onMouseEnter={() => (hoverRef.current = true)}
          onMouseLeave={() => (hoverRef.current = false)}
          className="max-h-[calc(100vh-320px)] overflow-y-auto px-5 pb-4 pt-3.5"
        >
          {visible.map((l) => (
            <LogRow key={l.id} line={l} />
          ))}
          <div className="font-mono text-[12.5px] leading-[2] text-[#6E6557]">
            {running ? (
              <>
                waiting for next event… <span className="log-cursor">▊</span>
              </>
            ) : (
              <span>— end of run —</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const isReason = line.verb === "REASON";
  return (
    <div className="grid grid-cols-[70px_158px_88px_1fr] gap-3.5 font-mono text-[12.5px] leading-[2] tabular-nums">
      <span className="text-[#6E6557]">{line.time}</span>
      <span className="truncate text-[#D8CFC0]">
        <span style={{ color: line.batchHue, opacity: 0.85 }}>{line.batchLabel}</span>·{line.unitTag}
      </span>
      <span className={`font-medium tracking-[0.03em] ${VERB_TONE[line.verb]}`}>{line.verb}</span>
      <span className={isReason ? "italic text-[#C6BCA9]" : "truncate text-[#A79D8C]"}>{line.message}</span>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 font-mono text-xs ${
        active
          ? "border-foreman-primary bg-foreman-primary text-white"
          : "border-[#D6C9B5] bg-foreman-card text-foreman-dim hover:text-foreman-ink"
      }`}
    >
      {children}
    </button>
  );
}
