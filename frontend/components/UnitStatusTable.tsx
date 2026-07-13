import type { Unit, UnitStatus } from "@/lib/types";
import StatusBadge from "./StatusBadge";

// Any terminal status has a diff/test log worth inspecting, not just the
// original passed/escalated pair.
const TERMINAL_STATUSES: UnitStatus[] = [
  "passed",
  "escalated",
  "blocked",
  "generation_failed",
  "system_error",
];

export type UnitView = { unitId: string; view: "diff" | "preview" } | null;

interface UnitStatusTableProps {
  units: Unit[];
  // When provided, resolved units get "Diff" / "Live Preview" actions.
  selected?: UnitView;
  onSelect?: (next: UnitView) => void;
}

const actionClasses =
  "rounded border px-2 py-0.5 text-xs transition-colors disabled:opacity-40";

export default function UnitStatusTable({ units, selected, onSelect }: UnitStatusTableProps) {
  const showActions = onSelect !== undefined;

  const toggle = (unitId: string, view: "diff" | "preview") => {
    if (!onSelect) return;
    const isActive = selected?.unitId === unitId && selected.view === view;
    onSelect(isActive ? null : { unitId, view });
  };

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-slate-400 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Unit</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Attempt</th>
            {showActions && <th className="px-3 py-2 font-medium">Result</th>}
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => {
            const resolved = TERMINAL_STATUSES.includes(unit.status);
            return (
              <tr key={unit.unitId} className="border-t border-slate-800">
                <td className="px-3 py-2 font-mono text-xs text-slate-300">
                  {unit.scopeGlob}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={unit.status} />
                </td>
                <td className="px-3 py-2 text-slate-400">{unit.attempt}</td>
                {showActions && (
                  <td className="px-3 py-2">
                    {resolved && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(unit.unitId, "diff")}
                          className={`${actionClasses} ${
                            selected?.unitId === unit.unitId && selected.view === "diff"
                              ? "border-blue-500 text-blue-300"
                              : "border-slate-700 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          View Diff
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(unit.unitId, "preview")}
                          className={`${actionClasses} ${
                            selected?.unitId === unit.unitId && selected.view === "preview"
                              ? "border-green-500 text-green-300"
                              : "border-slate-700 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Live Preview
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {units.length === 0 && (
            <tr>
              <td
                colSpan={showActions ? 4 : 3}
                className="px-3 py-6 text-center text-slate-500"
              >
                No units yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
