// Mirrors PROJECT.md sections 6 (data models) and 7 (contracts) exactly.
// Do not add fields that aren't in the documented contract.

export type RepoStatus = "pulling" | "ready" | "failed";

export interface Repo {
  repoId: string;
  repoUrl: string;
  status: RepoStatus;
}

export interface Candidate {
  candidateId: string;
  scopeGlobs: string[];
  centralityScore: number;
  recentActivityScore: number;
  combinedScore: number;
  blacklisted: boolean;
}

export interface CandidatesResponse {
  repoId: string;
  candidates: Candidate[];
}

export interface GraphNode {
  id: string;
  inDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphResponse {
  repoId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ManualSeam {
  scopeGlobs: string[];
  beforePattern: string;
  afterPattern: string;
  invariants: string[];
  testCommand: string;
}

export interface SeamRequest {
  candidateId: string | null;
  manualSeam: ManualSeam | null;
}

export interface Seam {
  seamId: string;
  scopeGlobs: string[];
  beforePattern: string;
  afterPattern: string;
  invariants: string[];
  testCommand: string;
}

export type CampaignStatus = "running" | "completed" | "failed";

export interface CampaignCreated {
  campaignId: string;
  status: "running";
  unitCount: number;
}

export type UnitStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "retrying"
  | "escalated";

export interface Unit {
  unitId: string;
  scopeGlob: string;
  status: UnitStatus;
  attempt: number;
  diff: string | null;
  failureLog: string | null;
}

export interface Campaign {
  campaignId: string;
  seamId: string;
  status: CampaignStatus;
  units: Unit[];
}

export interface FinalizeResult {
  campaignId: string;
  prUrl: string;
  acceptedUnits: number;
  escalatedUnits: number;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  db: "connected" | "unavailable";
}

export interface ApiErrorShape {
  error: string;
  message: string;
}

// --- WebSocket contract: /ws/campaign/{campaignId}, server -> client only ---

export interface CampaignStartedEvent {
  campaignId: string;
}

export interface UnitStatusEvent {
  unitId: string;
  status: string;
  attempt: number;
}

export interface UnitReasoningEvent {
  unitId: string;
  text: string;
}

export interface UnitEscalatedEvent {
  unitId: string;
  failureLog: string;
}

export interface CampaignCompletedEvent {
  campaignId: string;
}

export interface CampaignFailedEvent {
  reason: string;
}

export type CampaignWsEvent =
  | { event: "campaign_started"; data: CampaignStartedEvent }
  | { event: "unit_status"; data: UnitStatusEvent }
  | { event: "unit_reasoning"; data: UnitReasoningEvent }
  | { event: "unit_escalated"; data: UnitEscalatedEvent }
  | { event: "campaign_completed"; data: CampaignCompletedEvent }
  | { event: "campaign_failed"; data: CampaignFailedEvent };
