import { BACKEND_BASE_URL } from "./config";
import type {
  ApiErrorShape,
  ApplyResult,
  Campaign,
  CampaignCreated,
  CandidatesResponse,
  Discovery,
  FinalizeResult,
  GithubStatus,
  GraphResponse,
  HealthResponse,
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

  createRepo: (repoUrl: string) =>
    request<Repo>("POST", "/repo", { repoUrl }),

  getCandidates: (repoId: string) =>
    request<CandidatesResponse>("GET", `/repo/${repoId}/candidates`),

  getGraph: (repoId: string) =>
    request<GraphResponse>("GET", `/repo/${repoId}/graph`),

  discoverSeams: (repoId: string, objective: string) =>
    request<Discovery>("POST", `/repo/${repoId}/discover`, { objective }),

  createSeam: (repoId: string, body: SeamRequest) =>
    request<Seam>("POST", `/repo/${repoId}/seam`, body),

  createCampaign: (seamId: string) =>
    request<CampaignCreated>("POST", "/campaign", { seamId }),

  getCampaign: (campaignId: string) =>
    request<Campaign>("GET", `/campaign/${campaignId}`),

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
};
