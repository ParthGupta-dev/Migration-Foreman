"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Unit, UnitStatus } from "@/lib/types";
import { formatUnitStatusLabel, unitStatusNodeColor } from "@/utils/formatUnitStatus";

const TALLY_STATUSES: UnitStatus[] = [
  "passed",
  "escalated",
  "blocked",
  "generation_failed",
  "system_error",
];

export default function CampaignSummaryChart({ units }: { units: Unit[] }) {
  const data = TALLY_STATUSES.map((status) => ({
    status,
    label: formatUnitStatusLabel(status),
    count: units.filter((unit) => unit.status === status).length,
  }));

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
          <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.status} fill={unitStatusNodeColor(entry.status)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
