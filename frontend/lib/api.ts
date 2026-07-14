import { BACKEND_BASE_URL } from "./config";
import type {
  ApiErrorShape,
  ApplyResult,
  Campaign,
  CampaignCreated,
  CampaignEventsResponse,
  CampaignsResponse,
  CandidatesResponse,
  ChatHistory,
  ChatPostResponse,
  ChatRetryResponse,
  Discovery,
  FinalizeResult,
  GithubBranchesResponse,
  GithubRepositoriesResponse,
  GithubStatus,
  GraphResponse,
  HealthResponse,
  LlmProvidersResponse,
  Repo,
  Seam,
  SeamRequest,
  UnitPreview,
} from "./types";

export class ApiError extends Error {
  error: string;
  status: number;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.error = body.error;
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BACKEND_BASE_URL}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Send the mf_session cookie so the backend can see the GitHub OAuth
    // session on /github/status and /campaign/{id}/finalize.
    credentials: "include",
  });

  if (!res.ok) {
    let shape: ApiErrorShape;
    try {
      shape = await res.json();
    } catch {
      shape = { error: "unknown_error", message: res.statusText };
    }
    throw new ApiError(res.status, shape);
  }

  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("GET", "/health"),

  createRepo: (repoUrl: string, branch?: string) =>
    request<Repo>("POST", "/repo", branch ? { repoUrl, branch } : { repoUrl }),

  getCandidates: (repoId: string) =>
    request<CandidatesResponse>("GET", `/repo/${repoId}/candidates`),

  getGraph: (repoId: string) =>
    request<GraphResponse>("GET", `/repo/${repoId}/graph`),

  discoverSeams: (repoId: string, objective: string, model?: string | null) =>
    request<Discovery>("POST", `/repo/${repoId}/discover`, model ? { objective, model } : { objective }),

  llmProviders: () => request<LlmProvidersResponse>("GET", "/llm/providers"),

  createSeam: (repoId: string, body: SeamRequest) =>
    request<Seam>("POST", `/repo/${repoId}/seam`, body),

  createCampaign: (seamId: string) =>
    request<CampaignCreated>("POST", "/campaign", { seamId }),

  getCampaign: (campaignId: string) =>
    request<Campaign>("GET", `/campaign/${campaignId}`),

  // Server-backed campaign history (gap G3 now live) — powers a real,
  // cross-browser sidebar history widget.
  getCampaigns: () => request<CampaignsResponse>("GET", "/campaigns"),

  // Real unit_events history (gap G4 now live), oldest-first + paginated —
  // the Log page's backfill and the Overview replay build on this instead of
  // synthesising a timeline from final unit states.
  getCampaignEvents: (campaignId: string, limit = 500, offset = 0) =>
    request<CampaignEventsResponse>(
      "GET",
      `/campaign/${campaignId}/events?limit=${limit}&offset=${offset}`
    ),

  // Conversational chat (Phase 9 backend now live). getChat returns history;
  // postChat persists both turns and returns a real reply; retryUnit re-runs
  // verification for one escalated/blocked/failed unit for real.
  getChat: (campaignId: string) =>
    request<ChatHistory>("GET", `/campaign/${campaignId}/chat`),

  postChat: (campaignId: string, message: string, unitRef?: string | null) =>
    request<ChatPostResponse>("POST", `/campaign/${campaignId}/chat`, unitRef ? { message, unitRef } : { message }),

  retryUnit: (campaignId: string, unitId: string) =>
    request<ChatRetryResponse>("POST", `/campaign/${campaignId}/chat/retry-unit/${unitId}`),

  getUnitPreview: (campaignId: string, unitId: string) =>
    request<UnitPreview>("GET", `/campaign/${campaignId}/unit/${unitId}/preview`),

  applyCampaignLocally: (campaignId: string) =>
    request<ApplyResult>("POST", `/campaign/${campaignId}/apply`),

  finalizeCampaign: (campaignId: string, githubToken?: string) =>
    request<FinalizeResult>(
      "POST",
      `/campaign/${campaignId}/finalize`,
      githubToken ? { githubToken } : undefined
    ),

  githubStatus: () => request<GithubStatus>("GET", "/github/status"),

  githubRepositories: () =>
    request<GithubRepositoriesResponse>("GET", "/github/repositories"),

  githubBranches: (owner: string, name: string) =>
    request<GithubBranchesResponse>(
      "GET",
      `/github/repository/${owner}/${name}/branches`
    ),
};

// The OAuth dance is a full-page browser navigation (GitHub must render its
// authorize screen), not an XHR — navigate here to start it. `next` is the
// frontend path to land back on afterwards.
export function githubOauthStartUrl(next: string): string {
  return `${BACKEND_BASE_URL}/github/oauth/start?next=${encodeURIComponent(next)}`;
}
