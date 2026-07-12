import type { Unit } from "@/lib/types";
import StatusBadge from "./StatusBadge";

export default function UnitStatusTable({ units }: { units: Unit[] }) {
  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-slate-400 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Unit</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Attempt</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.unitId} className="border-t border-slate-800">
              <td className="px-3 py-2 font-mono text-xs text-slate-300">
                {unit.scopeGlob}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={unit.status} />
              </td>
              <td className="px-3 py-2 text-slate-400">{unit.attempt}</td>
            </tr>
          ))}
          {units.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                No units yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
