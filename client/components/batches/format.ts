// Batches page display mappings (mock: design/mocks/batches.html — the PILL,
// FLAMP, and meta strings). Status/pill/lamp colours come only from the
// foreman.* token set; no fabricated test fractions or durations — the backend
// exposes status + attempt per unit and nothing more until Phase 8 (gap G4).

import type { BatchStatus } from "@/lib/batches";
import type { Unit, UnitStatus } from "@/lib/types";

export interface PillSpec {
  cls: string; // pill background + text token classes
  label: string;
  lamp: string; // lamp background token class
  pulse: boolean;
}

// Mirrors the mock's PILL map exactly.
export const BATCH_PILL: Record<BatchStatus, PillSpec> = {
  escalated: { cls: "bg-foreman-fail-bg text-foreman-fail-text", label: "Escalated", lamp: "bg-foreman-fail", pulse: false },
  retrying: { cls: "bg-foreman-retry-bg text-foreman-retry-text", label: "Retrying", lamp: "bg-foreman-retry", pulse: true },
  running: { cls: "bg-foreman-run-bg text-foreman-run-text", label: "Running", lamp: "bg-foreman-run", pulse: true },
  accepted: { cls: "bg-foreman-ok-bg text-foreman-ok-text", label: "Accepted", lamp: "bg-foreman-ok", pulse: false },
  queued: { cls: "bg-foreman-queued-bg text-foreman-queued-text", label: "Queued", lamp: "bg-foreman-queued", pulse: false },
};

// Tinted tile background for the attention statuses (mock `.btile.b-fail` /
// `.b-retry`) — the two literal hex tints from batches.html, not tokens.
export const BATCH_TILE_TINT: Partial<Record<BatchStatus, string>> = {
  escalated: "border-[#D9A99A] bg-[#F7EEE9]",
  retrying: "border-[#D9BC8E] bg-[#F8F1E4]",
};

export type FileVisual = "ok" | "run" | "retry" | "fail" | "queued";

export function fileVisual(status: UnitStatus): FileVisual {
  switch (status) {
    case "passed":
      return "ok";
    case "running":
      return "run";
    case "retrying":
    case "failed":
      return "retry";
    case "escalated":
      return "fail";
    case "pending":
      return "queued";
    default:
      return "fail"; // blocked / generation_failed / system_error
  }
}

// Mirrors the mock's FLAMP map.
export const FILE_LAMP: Record<FileVisual, { cls: string; pulse: boolean }> = {
  ok: { cls: "bg-foreman-ok", pulse: false },
  run: { cls: "bg-foreman-run", pulse: true },
  retry: { cls: "bg-foreman-retry", pulse: true },
  fail: { cls: "bg-foreman-fail", pulse: false },
  queued: { cls: "bg-foreman-queued", pulse: false },
};

// The mono meta line on each file card. Uses only what the backend returns
// (status + attempt); the mock's live examples of "tests 6/6 · 2m 18s" would
// be invented here, so they're deliberately omitted.
export function unitMeta(u: Unit): string {
  switch (u.status) {
    case "passed":
      return `accepted · round ${u.attempt}`;
    case "running":
      return `running · round ${u.attempt}`;
    case "retrying":
      return `retrying · round ${u.attempt}`;
    case "failed":
      return `failed · round ${u.attempt}`;
    case "escalated":
      return `escalated · ${u.attempt} ${u.attempt === 1 ? "round" : "rounds"} · retry loop exhausted`;
    case "pending":
      return "queued";
    case "blocked":
      return `blocked (provider) · round ${u.attempt}`;
    case "generation_failed":
      return `generation failed · round ${u.attempt}`;
    case "system_error":
      return `system error · round ${u.attempt}`;
    default:
      return `round ${u.attempt}`;
  }
}

// Placeholder line for cards with no diff yet (mock `f.nodiff`).
export function noDiffReason(status: UnitStatus): string {
  if (status === "running" || status === "retrying")
    return "in progress — diff appears when the round completes";
  if (status === "pending") return "queued — waiting for a free worktree slot";
  return "no diff was produced for this file";
}

export function statusWord(status: UnitStatus): string {
  switch (status) {
    case "blocked":
      return "Blocked (provider)";
    case "generation_failed":
      return "Generation failed";
    case "system_error":
      return "System error";
    default:
      return status;
  }
}
