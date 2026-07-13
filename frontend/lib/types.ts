// Mirrors the backend contracts (PROJECT.md section 7 plus the flagged
// additions in backend/main.py: GET /repo/{id}/graph, POST /repo/{id}/discover,
// and the optional seam overrides for repos without .migration-foreman.json).

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
  // Optional overrides for the candidateId path (repos without a
  // .migration-foreman.json). Precedence: request > repo config > inferred.
  beforePattern?: string;
  afterPattern?: string;
  invariants?: string[];
  testCommand?: string;
}

export type PlanRisk = "low" | "medium" | "high";

// --- AI Seam Discovery: POST /repo/{id}/discover ---

export interface RepoSummary {
  fileCount: number;
  sourceFileCount: number;
  languages: Record<string, number>;
  topDirectories: string[];
  graphNodes: number;
  graphEdges: number;
  mostDependedOnFiles: string[];
}

export interface DiscoveredSeam {
  // Discovery-local id ("seam-0"); a real seam row is only created when the
  // human approves it via POST /repo/{id}/seam.
  seamId: string;
  title: string;
  description: string;
  executionOrder: number;
  dependsOn: string[];
  beforePattern: string;
  afterPattern: string;
  scopeGlobs: string[];
  invariants: string[];
  testCommand: string | null;
  risk: PlanRisk;
  breakingChanges: boolean;
  confidence: number;
  reasoning: string;
  groundedFiles: string[];
  estimatedFiles: number;
  occurrences: number;
  repairedScope: boolean;
}

export interface DroppedSeam {
  title: string;
  reason: string;
}

export interface Discovery {
  repoId: string;
  objective: string;
  repoSummary: RepoSummary;
  seams: DiscoveredSeam[];
  droppedSeams: DroppedSeam[];
  seamCount: number;
  totalEstimatedFiles: number;
  overallRisk: PlanRisk;
  estimatedMinutes: number;
}

// Client-side queue of approved-but-not-yet-executed seams (sessionStorage):
// seams execute one campaign at a time, in the approved execution order.
export interface SeamQueue {
  repoId: string;
  seams: { seamId: string; title: string }[];
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
  // The seam's verification command — shown live so an inferred command that
  // guessed wrong is visible immediately, not three retries deep.
  testCommand: string;
  units: Unit[];
}

export type PreviewFileType = "markdown" | "html" | "css" | "code";

export interface UnitPreview {
  unitId: string;
  path: string;
  fileType: PreviewFileType;
  language: string | null;
  before: string | null; // file content on the base branch
  after: string | null; // file content on the campaign branch (null until merged)
  testLog: string | null;
}

// Default publishing path: POST /campaign/{id}/apply — no GitHub involved.
export interface ApplyResult {
  campaignId: string;
  localPath: string;
  baseBranch: string;
  campaignBranch: string;
  changedFiles: string[];
  diffSummary: string;
  alreadyApplied: boolean;
  gitCommands: string[];
  acceptedUnits: number;
  escalatedUnits: number;
}

export interface FinalizeResult {
  campaignId: string;
  prUrl: string;
  acceptedUnits: number;
  escalatedUnits: number;
}

export interface GithubStatus {
  connected: boolean;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  db: "connected" | "unavailable";
  // Active LLM provider, e.g. "codex:gpt-5-codex", "groq:llama-3.3-70b-versatile",
  // "mock", or "unconfigured".
  llm: string;
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
