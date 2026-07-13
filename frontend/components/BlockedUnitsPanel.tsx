import type { Unit, UnitStatus } from "@/lib/types";
import { formatUnitStatusLabel } from "@/utils/formatUnitStatus";
import DiffView from "./DiffView";

// Terminal states that are infrastructure/system noise, not engineering
// judgement calls -- deliberately kept out of EscalationPanel's human
// Review queue (which filters strictly on status === "escalated").
const NON_REVIEW_STATUSES: UnitStatus[] = ["blocked", "generation_failed", "system_error"];

export default function BlockedUnitsPanel({ units }: { units: Unit[] }) {
  const blocked = units.filter((unit) => NON_REVIEW_STATUSES.includes(unit.status));

  if (blocked.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No infrastructure or system issues — every unit either passed, is
        still retrying, or is in the human Review queue.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        These units did not complete because of an LLM/provider issue or an
        internal error — not a bad migration. They do not require
        engineering review; consider re-running the campaign once the
        underlying issue is resolved.
      </p>
      {blocked.map((unit) => (
        <div key={unit.unitId} className="border border-slate-700 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-300">{unit.scopeGlob}</span>
            <span className="text-xs text-slate-400">
              {formatUnitStatusLabel(unit.status)} after {unit.attempt} attempt(s)
            </span>
          </div>
          {unit.diff && <DiffView diff={unit.diff} />}
          {unit.failureLog && (
            <pre className="text-xs font-mono bg-black/40 border border-slate-800 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto text-slate-400">
              {unit.failureLog}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
