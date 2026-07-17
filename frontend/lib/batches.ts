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
// reserved for lamps/pills/bars per FRONTEND_REDESIGN.md §3). Exported so the
// Plan legend and Overview scene draw from the same list.
export const CATEGORY_PALETTE = [
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

// A batch derived from raw scope globs (the Plan page, before any units exist).
// Same id/colour assignment as deriveBatches — labels sorted, B-01.. in order,
// palette cycled — so a batch keeps one identity/colour across every page.
export interface GlobBatch {
  id: string;
  label: string;
  color: string;
  globs: string[];
}

export function deriveGlobBatches(scopeGlobs: string[]): GlobBatch[] {
  const groups = new Map<string, string[]>();
  for (const glob of scopeGlobs) {
    const label = topLevelDir(glob);
    const group = groups.get(label);
    if (group) group.push(glob);
    else groups.set(label, [glob]);
  }
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((label, index) => ({
      id: `B-${String(index + 1).padStart(2, "0")}`,
      label,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
      globs: groups.get(label)!.sort((a, b) => a.localeCompare(b)),
    }));
}

// Per-batch outcome tally for the Summary bars (mock: summary.html `.obar`).
export interface BatchOutcome {
  accepted: number;
  escalated: number;
  blocked: number;
  running: number;
  total: number;
}

export function batchOutcome(units: Unit[]): BatchOutcome {
  const total = units.length;
  const accepted = units.filter((u) => u.status === "passed").length;
  const escalated = units.filter((u) => u.status === "escalated").length;
  const blocked = units.filter((u) => isBlockedStatus(u.status)).length;
  const running = units.filter(
    (u) => u.status === "running" || u.status === "retrying" || u.status === "pending" || u.status === "failed"
  ).length;
  return { accepted, escalated, blocked, running, total };
}

// --- Batch-level status (Batches page, mock: batches.html) ---
// The board tiles carry one rolled-up status per batch, derived from the
// batch's units. Blocked-family units are excluded here — they're pulled into
// their own strip (isBlockedStatus) and never colour a batch tile.

export type BatchStatus = "escalated" | "retrying" | "running" | "accepted" | "queued";

// Attention-first board order (frontend_refactor.md §2):
// escalated -> retrying -> running -> queued -> accepted.
const BATCH_STATUS_RANK: Record<BatchStatus, number> = {
  escalated: 0,
  retrying: 1,
  running: 2,
  queued: 3,
  accepted: 4,
};

export function activeUnits(units: Unit[]): Unit[] {
  return units.filter((u) => !isBlockedStatus(u.status));
}

export function batchStatus(units: Unit[]): BatchStatus {
  const active = activeUnits(units);
  if (active.some((u) => u.status === "escalated")) return "escalated";
  if (active.some((u) => u.status === "retrying" || u.status === "failed")) return "retrying";
  if (active.some((u) => u.status === "running")) return "running";
  if (active.length > 0 && active.every((u) => u.status === "passed")) return "accepted";
  return "queued";
}

// Board display order — a copy sorted by attention; batch IDs stay stable
// (assigned by label order in deriveBatches) so `?open=B-xx` never shifts.
export function sortBatchesForBoard(batches: Batch[]): Batch[] {
  return [...batches].sort((a, b) => {
    const rank = BATCH_STATUS_RANK[batchStatus(a.units)] - BATCH_STATUS_RANK[batchStatus(b.units)];
    return rank !== 0 ? rank : a.id.localeCompare(b.id);
  });
}

export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// The one-line reason under an escalated/retrying tile — synthesised from the
// unit that set the batch status (real per-round history is Phase 8 / gap G4).
export function batchReason(units: Unit[], status: BatchStatus): string {
  if (status === "escalated") {
    const u = units.find((x) => x.status === "escalated");
    if (u) return `${basename(u.scopeGlob)} — ${u.attempt} ${u.attempt === 1 ? "attempt" : "attempts"} exhausted`;
  }
  if (status === "retrying") {
    const u = units.find((x) => x.status === "retrying" || x.status === "failed");
    if (u) return `${basename(u.scopeGlob)} — round ${u.attempt}`;
  }
  return "";
}

export function batchCounts(units: Unit[]): string {
  const total = units.length;
  const done = units.filter((u) => u.status === "passed").length;
  return `${total} ${total === 1 ? "file" : "files"} · ${done}/${total} accepted`;
}
