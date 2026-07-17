// Client-side campaign store — the no-backend-change enabler for Phases 1-7
// (frontend_refactor.md §3). Written once at Start campaign on the landing
// page; the only source for Plan/Chat/history data the backend doesn't
// persist yet (gaps G1-G3, §4). Superseded by server data in Phase 8, at
// which point this becomes a write-through cache.
//
// Known, accepted limitations (erased by Phase 8): history is per-browser;
// opening a campaign URL on another machine renders live pages fine but
// Plan/Chat fall back to a "plan record not available on this browser"
// empty state; durations are client-clock based.

import type {
  DiscoveredSeam,
  DroppedSeam,
  RepoSummary,
  Seam,
} from "./types";

export interface ChatMessage {
  role: "foreman" | "user";
  text: string;
  ts: string;
}

export interface StoredCampaign {
  campaignId: string;
  repoId: string; // GET /campaign/{id} doesn't return this (gap G1)
  repoUrl: string;
  seamId: string;
  title: string; // discovered seam title / manual seam summary
  mode: "scan" | "describe" | "autonomous";
  model: string; // /health llm at planning time
  objective: string; // the typed intent
  plannedAt: string;
  approvedAt: string;
  startedAt: string;
  completedAt?: string;
  outcome?: "completed" | "failed";
  seam: Seam; // patterns, scope, invariants, testCommand
  discovery?: {
    // Describe/Autonomous: the approved DiscoveredSeam + repoSummary for
    // grounding stats on the Plan page.
    seam: DiscoveredSeam;
    repoSummary: RepoSummary;
    droppedSeams: DroppedSeam[];
  };
  chatExcerpt: ChatMessage[]; // landing-session messages replayed on the Chat page
}

const STORAGE_KEY = "mf.campaigns.v1";

interface StoreShape {
  version: 1;
  campaigns: StoredCampaign[];
}

function readStore(): StoreShape {
  if (typeof window === "undefined") return { version: 1, campaigns: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, campaigns: [] };
    const parsed = JSON.parse(raw) as StoreShape;
    if (parsed.version !== 1 || !Array.isArray(parsed.campaigns)) {
      return { version: 1, campaigns: [] };
    }
    return parsed;
  } catch {
    return { version: 1, campaigns: [] };
  }
}

function writeStore(store: StoreShape): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

// Called once at Start campaign; upserts by campaignId so a retried
// creation flow never duplicates an entry.
export function saveCampaign(campaign: StoredCampaign): void {
  const store = readStore();
  const index = store.campaigns.findIndex((c) => c.campaignId === campaign.campaignId);
  if (index === -1) store.campaigns.push(campaign);
  else store.campaigns[index] = campaign;
  writeStore(store);
}

export function getCampaign(campaignId: string): StoredCampaign | null {
  return readStore().campaigns.find((c) => c.campaignId === campaignId) ?? null;
}

// Newest-first, for the sidebar history widget.
export function listCampaigns(): StoredCampaign[] {
  return [...readStore().campaigns].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function updateCampaign(
  campaignId: string,
  patch: Partial<StoredCampaign>
): void {
  const store = readStore();
  const index = store.campaigns.findIndex((c) => c.campaignId === campaignId);
  if (index === -1) return;
  store.campaigns[index] = { ...store.campaigns[index], ...patch };
  writeStore(store);
}

export function markCampaignTerminal(
  campaignId: string,
  outcome: "completed" | "failed"
): void {
  updateCampaign(campaignId, { completedAt: new Date().toISOString(), outcome });
}
