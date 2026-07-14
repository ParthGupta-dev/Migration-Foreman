// Batches are a frontend-only concept — the backend has units (one per
// file), no batches. Units are grouped client-side by the top-level
// directory of their scopeGlob; batch IDs are assigned in sorted label
// order. This is the one shared derivation used by Overview, Batches, Log
// and Summary so grouping/colors never disagree between pages.

import type { Unit, UnitStatus } from "./types";

export interface Batch {
  id: string; // "B-01", "B-02", ...
  label: string; // top-level directory of the units' scopeGlobs ("." for root files)
  color: string; // fixed category hue, cycled deterministically by batch index
  units: Unit[];
}

// Fixed, deterministic category palette — never a status color (those stay
// reserved for lamps/pills/bars per FRONTEND_REDESIGN.md §3).
const CATEGORY_PALETTE = [
  "#B8894F", // amber
  "#7C9463", // sage
  "#8A8072", // taupe
  "#B15D48", // clay
  "#6E7F8D", // slate-blue
  "#9C7A54", // bronze
];

// blocked/generation_failed/system_error are terminal infra failures, not
// engineering-judgement escalations (see UnitStatus doc comments in
// types.ts) — kept out of the normal attention-first sort bucket so they can
// be rendered as a separate "blocked" strip instead of mixed into escalations.
const BLOCKED_STATUSES = new Set<UnitStatus>([
  "blocked",
  "generation_failed",
  "system_error",
]);

export function isBlockedStatus(status: UnitStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}

// Attention-first ordering: escalated -> retrying/failed -> running ->
// queued -> accepted. Blocked-family statuses sort last since they're
// pulled into their own strip by the consuming page, not this list.
const SORT_RANK: Record<UnitStatus, number> = {
  escalated: 0,
  retrying: 1,
  failed: 1,
  running: 2,
  pending: 3,
  passed: 4,
  blocked: 5,
  generation_failed: 5,
  system_error: 5,
};

export function sortUnits(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => SORT_RANK[a.status] - SORT_RANK[b.status]);
}

function topLevelDir(scopeGlob: string): string {
  const parts = scopeGlob.split("/");
  return parts.length > 1 ? parts[0] : ".";
}

export function deriveBatches(units: Unit[]): Batch[] {
  const groups = new Map<string, Unit[]>();
  for (const unit of units) {
    const label = topLevelDir(unit.scopeGlob);
    const group = groups.get(label);
    if (group) group.push(unit);
    else groups.set(label, [unit]);
  }

  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((label, index) => ({
      id: `B-${String(index + 1).padStart(2, "0")}`,
      label,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
      units: sortUnits(groups.get(label)!),
    }));
}

export function batchForUnit(batches: Batch[], unitId: string): Batch | undefined {
  return batches.find((batch) => batch.units.some((unit) => unit.unitId === unitId));
}
