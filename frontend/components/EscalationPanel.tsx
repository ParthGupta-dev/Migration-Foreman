import type { Unit } from "@/lib/types";
import DiffView from "./DiffView";

export default function EscalationPanel({ units }: { units: Unit[] }) {
  const escalated = units.filter((unit) => unit.status === "escalated");

  if (escalated.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No escalations — every unit is still within its retry budget.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {escalated.map((unit) => (
        <div key={unit.unitId} className="border border-purple-900 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-300">{unit.scopeGlob}</span>
            <span className="text-xs text-purple-400">
              Escalated after {unit.attempt} attempts
            </span>
          </div>
          {unit.diff && <DiffView diff={unit.diff} />}
          {unit.failureLog && (
            <pre className="text-xs font-mono bg-black/40 border border-slate-800 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto text-red-300">
              {unit.failureLog}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
