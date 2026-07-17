// Converts the real unit_events history (GET /campaign/{id}/events, gap G4 now
// live) into terminal log lines for the Log page (mock: design/mocks/log.html).
// The mock synthesised these from final states; we build them from the actual
// ordered event stream instead, so timing and per-round reasoning are real.

import type { Batch } from "./batches";
import { batchForUnit } from "./batches";
import type { CampaignEvent } from "./types";

export type LogVerb =
  | "PLAN"
  | "DISPATCH"
  | "REASON"
  | "PASS"
  | "FAIL"
  | "RETRY"
  | "ESCALATE"
  | "BLOCK";

export interface LogLine {
  id: string;
  time: string; // HH:MM:SS
  batchLabel: string; // "src", "lib", … or "—"
  batchHue: string;
  unitTag: string; // basename of the scope glob
  verb: LogVerb;
  message: string;
  createdAt: string;
}

// Verb colour class on the dark terminal (mock VCLASS).
export const VERB_TONE: Record<LogVerb, string> = {
  PLAN: "text-[#857B6B]",
  DISPATCH: "text-[#C6BCA9]",
  REASON: "text-[#857B6B]",
  PASS: "text-[#96B577]",
  FAIL: "text-[#D98873]",
  RETRY: "text-[#D9A961]",
  ESCALATE: "text-[#D98873]",
  BLOCK: "text-[#D98873]",
};

// The verb chips shown above the terminal (mock filters).
export const VERB_FILTERS: { key: LogVerb; label: string }[] = [
  { key: "DISPATCH", label: "dispatch" },
  { key: "REASON", label: "reason" },
  { key: "PASS", label: "pass" },
  { key: "FAIL", label: "fail" },
  { key: "RETRY", label: "retry" },
  { key: "ESCALATE", label: "escalate" },
];

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--:--" : d.toLocaleTimeString("en-GB", { hour12: false });
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// Map one event to a verb, or null to drop it (e.g. per-unit "created" noise —
// we emit a single PLAN header line for the batch instead).
function verbFor(ev: CampaignEvent): LogVerb | null {
  if (ev.eventType === "codex_rationale") return "REASON";
  if (ev.eventType === "status_change") {
    const status = (ev.metadata?.status as string) ?? "";
    switch (status) {
      case "running":
        return "DISPATCH";
      case "failed":
        return "FAIL";
      case "retrying":
        return "RETRY";
      case "passed":
        return "PASS";
      case "escalated":
        return "ESCALATE";
      case "blocked":
      case "generation_failed":
      case "system_error":
        return "BLOCK";
      default:
        return null;
    }
  }
  return null; // "created"
}

export function eventsToLogLines(events: CampaignEvent[], batches: Batch[]): LogLine[] {
  const lines: LogLine[] = [];

  // One synthetic PLAN header from the first "created" event's timestamp.
  const firstCreated = events.find((e) => e.eventType === "created");
  const unitCount = new Set(events.filter((e) => e.eventType === "created").map((e) => e.unitId)).size;
  if (firstCreated) {
    lines.push({
      id: "plan",
      time: clock(firstCreated.createdAt),
      batchLabel: "—",
      batchHue: "#857B6B",
      unitTag: "—",
      verb: "PLAN",
      message: `seam grounded · ${unitCount} unit${unitCount === 1 ? "" : "s"} created across ${batches.length} batch${batches.length === 1 ? "" : "es"}`,
      createdAt: firstCreated.createdAt,
    });
  }

  for (const ev of events) {
    const verb = verbFor(ev);
    if (!verb) continue;
    const batch = batchForUnit(batches, ev.unitId);
    lines.push({
      id: ev.eventId,
      time: clock(ev.createdAt),
      batchLabel: batch?.label ?? "—",
      batchHue: batch?.color ?? "#857B6B",
      unitTag: basename(ev.scopeGlob),
      verb,
      message: ev.message,
      createdAt: ev.createdAt,
    });
  }

  return lines;
}
