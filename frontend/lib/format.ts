// Shared display formatting for the dashboard pages (Plan / Log / Summary /
// Overview). Figures use tabular-nums at the callsite; these just produce the
// strings. Durations are real when both timestamps come from the server
// (createdAt/completedAt, gap G5 now live) and client-clock based otherwise.

export function clockTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

// Compact human duration between two instants: "31s", "47m", "1h 03m".
export function duration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, "0")}m`;
}

// Count non-overlapping occurrences of a literal pattern in a string.
export function countOccurrences(text: string, pattern: string): number {
  if (!pattern) return 0;
  let count = 0;
  let idx = text.indexOf(pattern);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(pattern, idx + pattern.length);
  }
  return count;
}

// ± lines-of-code from a set of unified diffs (added/removed lines, excluding
// the file/hunk headers). Used by the Summary figures row.
export function diffLineCounts(diffs: (string | null)[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    if (!diff) continue;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}
