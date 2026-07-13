import type { UnitStatus } from "@/lib/types";

export const UNIT_STATUS_ORDER: UnitStatus[] = [
  "pending",
  "running",
  "passed",
  "failed",
  "retrying",
  "escalated",
  "blocked",
  "generation_failed",
  "system_error",
];

const LABELS: Record<UnitStatus, string> = {
  pending: "Pending",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  retrying: "Retrying",
  escalated: "Escalated",
  blocked: "Blocked (provider)",
  generation_failed: "Generation failed",
  system_error: "System error",
};

const CLASSES: Record<UnitStatus, string> = {
  pending: "bg-slate-700 text-slate-200",
  running: "bg-blue-600 text-white",
  passed: "bg-green-600 text-white",
  failed: "bg-red-600 text-white",
  retrying: "bg-amber-600 text-white",
  escalated: "bg-purple-600 text-white",
  blocked: "bg-slate-500 text-white",
  generation_failed: "bg-orange-600 text-white",
  system_error: "bg-rose-700 text-white",
};

const NODE_COLORS: Record<UnitStatus, string> = {
  pending: "#475569",
  running: "#2563eb",
  passed: "#16a34a",
  failed: "#dc2626",
  retrying: "#d97706",
  escalated: "#9333ea",
  blocked: "#64748b",
  generation_failed: "#ea580c",
  system_error: "#be123c",
};

export function formatUnitStatusLabel(status: string): string {
  return LABELS[status as UnitStatus] ?? status;
}

export function unitStatusBadgeClasses(status: string): string {
  return CLASSES[status as UnitStatus] ?? "bg-slate-600 text-white";
}

export function unitStatusNodeColor(status: string): string {
  return NODE_COLORS[status as UnitStatus] ?? "#475569";
}
