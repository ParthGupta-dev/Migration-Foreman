// One file card inside a batch detail (mock: batches.html `.fcard`). Header row
// (lamp · path · meta), then — where the data exists — the failure log, an
// attempt timeline, the diff, and a lazy live preview. Everything is derived
// from the real unit (status, attempt, diff, failureLog); the mock's per-round
// timestamps and prose aren't in the contract (gap G4), so the timeline shows
// only what a retry count actually tells us.

import type { Unit } from "@/lib/types";
import { DiffView, LogBlock } from "./CodeBlock";
import LivePreview from "./LivePreview";
import {
  FILE_LAMP,
  fileVisual,
  noDiffReason,
  unitMeta,
} from "./format";

export default function FileCard({
  unit,
  campaignId,
}: {
  unit: Unit;
  campaignId: string;
}) {
  const lamp = FILE_LAMP[fileVisual(unit.status)];
  const showFailLog =
    !!unit.failureLog &&
    (unit.status === "escalated" ||
      unit.status === "failed" ||
      unit.status === "blocked" ||
      unit.status === "generation_failed" ||
      unit.status === "system_error");
  const showTimeline = unit.attempt > 1;
  const canPreview = unit.status === "passed" || !!unit.diff;

  return (
    <div className="overflow-hidden rounded-card border border-foreman-line bg-foreman-card shadow-card">
      <div className="flex items-center gap-2.5 px-6 py-3.5">
        <span className={`h-2 w-2 flex-none rounded-full ${lamp.cls} ${lamp.pulse ? "pulse" : ""}`} />
        <span className="font-mono text-[13px] font-medium">{unit.scopeGlob}</span>
        <span className="ml-auto font-mono text-xs text-foreman-dim">{unitMeta(unit)}</span>
      </div>

      <div className="px-6 pb-[18px]">
        {showFailLog && (
          <Section first title="Failure log">
            <LogBlock text={unit.failureLog!} />
          </Section>
        )}

        {showTimeline && (
          <Section first={!showFailLog} title="Attempts">
            <Timeline unit={unit} />
          </Section>
        )}

        {unit.diff ? (
          <Section first={!showFailLog && !showTimeline} title="Diff">
            <DiffView diff={unit.diff} />
          </Section>
        ) : (
          <p className="font-mono text-xs text-foreman-dim">{noDiffReason(unit.status)}</p>
        )}

        {canPreview && <LivePreview campaignId={campaignId} unitId={unit.unitId} />}
      </div>
    </div>
  );
}

function Section({
  title,
  first,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={first ? "" : "mt-3.5"}>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreman-dim">
        {title}
      </h4>
      {children}
    </div>
  );
}

// Derived attempt timeline: N attempts means N-1 rounds failed and re-dispatched
// before the current one. We know the count and the final outcome — not the
// per-round timing or reasoning (Phase 8 / gap G4), so those are left out.
function Timeline({ unit }: { unit: Unit }) {
  const failed = { lamp: "bg-foreman-fail", pulse: false, verb: "text-foreman-fail-text", label: "FAILED" };
  const rounds = Array.from({ length: unit.attempt }, (_, i) => {
    const isLast = i === unit.attempt - 1;
    return { n: i + 1, ...(isLast ? finalOutcome(unit.status) : failed) };
  });

  return (
    <div className="flex flex-col">
      {rounds.map((r, i) => (
        <div key={r.n} className="grid grid-cols-[16px_1fr] gap-2 py-2">
          <div className="flex flex-col items-center pt-1">
            <span className={`h-2 w-2 flex-none rounded-full ${r.lamp} ${r.pulse ? "pulse" : ""}`} />
            {i < rounds.length - 1 && <span className="mt-1 w-px flex-1 bg-foreman-line" />}
          </div>
          <div>
            <div className="flex items-baseline gap-2 text-[13px]">
              <strong>Round {r.n}</strong>
              <span className={`font-mono text-xs ${r.verb}`}>{r.label}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function finalOutcome(status: Unit["status"]): {
  lamp: string;
  pulse: boolean;
  verb: string;
  label: string;
} {
  switch (status) {
    case "passed":
      return { lamp: "bg-foreman-ok", pulse: false, verb: "text-foreman-ok-text", label: "PASSED" };
    case "escalated":
      return { lamp: "bg-foreman-fail", pulse: false, verb: "text-foreman-fail-text", label: "ESCALATED" };
    case "running":
    case "retrying":
      return { lamp: "bg-foreman-retry", pulse: true, verb: "text-foreman-retry-text", label: "RUNNING" };
    default:
      return { lamp: "bg-foreman-fail", pulse: false, verb: "text-foreman-fail-text", label: "FAILED" };
  }
}
