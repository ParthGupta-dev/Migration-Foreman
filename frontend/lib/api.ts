import { BACKEND_BASE_URL } from "./config";
import type {
  ApiErrorShape,
  Campaign,
  CampaignCreated,
  CandidatesResponse,
  FinalizeResult,
  GraphResponse,
  HealthResponse,
  Repo,
  Seam,
  SeamRequest,
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

  createSeam: (repoId: string, body: SeamRequest) =>
    request<Seam>("POST", `/repo/${repoId}/seam`, body),

  createCampaign: (seamId: string) =>
    request<CampaignCreated>("POST", "/campaign", { seamId }),

  getCampaign: (campaignId: string) =>
    request<Campaign>("GET", `/campaign/${campaignId}`),

  finalizeCampaign: (campaignId: string) =>
    request<FinalizeResult>("POST", `/campaign/${campaignId}/finalize`),
};
