// Client-side queue of approved-but-not-yet-executed seams. Discovery can
// approve several seams at once, but campaigns run one at a time on a repo
// (the engine serializes git ops per campaign, not across campaigns), so the
// remainder waits here until the summary page starts the next one.

import type { SeamQueue } from "./types";

const SEAM_QUEUE_KEY = "mf-seam-queue";

export function readSeamQueue(): SeamQueue | null {
  try {
    const raw = sessionStorage.getItem(SEAM_QUEUE_KEY);
    if (!raw) return null;
    const queue = JSON.parse(raw) as SeamQueue;
    return Array.isArray(queue.seams) && queue.seams.length > 0 ? queue : null;
  } catch {
    return null;
  }
}

export function writeSeamQueue(queue: SeamQueue): void {
  if (queue.seams.length === 0) {
    sessionStorage.removeItem(SEAM_QUEUE_KEY);
  } else {
    sessionStorage.setItem(SEAM_QUEUE_KEY, JSON.stringify(queue));
  }
}

export function clearSeamQueue(): void {
  sessionStorage.removeItem(SEAM_QUEUE_KEY);
}
