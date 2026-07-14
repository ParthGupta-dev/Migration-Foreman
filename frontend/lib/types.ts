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

// The seam object embedded in GET /campaign/{id} (gap G1/G2, now live):
// the frozen Seam fields plus the nullable title/plan discovery persistence
// (only populated when a campaign was started via the landing-page flow —
// null for CLI-created campaigns).
export interface CampaignSeam extends Seam {
  title: string | null;
  plan: Record<string, unknown> | null;
}

export type CampaignStatus = "running" | "completed" | "failed";

export interface CampaignCreated {
  campaignId: string;
  status: "running";
  unitCount: number;
}

// Terminal states beyond "passed"/"escalated" (backend/verification/gate.py):
// blocked = LLM/provider infra failure on every attempt (429, timeout, empty
//   response, provider down) -- never reached a real verification.
// generation_failed = the model responded but never produced usable
//   migration content.
// system_error = an unexpected internal/environment failure.
// Only "escalated" belongs in the human Review queue (EscalationPanel).
export type UnitStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "retrying"
  | "escalated"
  | "blocked"
  | "generation_failed"
  | "system_error";

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
  // Additive, now-live enrichment (gap G1/G5): a reloaded/foreign browser can
  // reach the graph + seam record + real durations without the client store.
  repoId?: string;
  seam?: CampaignSeam;
  createdAt?: string;
  completedAt?: string | null;
}

// --- GET /campaigns (server-backed history, gap G3 now live) ---
export interface CampaignListItem {
  campaignId: string;
  title: string | null;
  status: CampaignStatus;
  repoId: string;
  repoUrl: string;
  createdAt: string;
  completedAt: string | null;
  unitCount: number;
  acceptedUnits: number;
  escalatedUnits: number;
}

export interface CampaignsResponse {
  campaigns: CampaignListItem[];
}

// --- GET /campaign/{id}/events (real unit_events history, gap G4 now live) ---
// Oldest-first, paginated. eventType is one of: "created" | "status_change"
// | "codex_rationale"; metadata varies by type (status/attempt, failureLogTail).
export interface CampaignEvent {
  eventId: string;
  unitId: string;
  scopeGlob: string;
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CampaignEventsResponse {
  campaignId: string;
  events: CampaignEvent[];
  nextOffset: number | null;
}

// --- Chat (Phase 9 backend now live) ---
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageRecord {
  messageId: string;
  role: ChatRole;
  content: string;
  // A real unit id (UUID) the message is scoped to, or null.
  unitRef: string | null;
  // e.g. "retry_unit" on a system message emitted by the retry endpoint.
  action: string | null;
  createdAt: string;
}

export interface ChatHistory {
  campaignId: string;
  messages: ChatMessageRecord[];
}

export interface ChatPostResponse {
  campaignId: string;
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
}

export interface ChatRetryResponse {
  unit: Unit;
  systemMessage: ChatMessageRecord;
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
  // True only when this browser has a real OAuth session — false when
  // `connected` is true merely because the backend has a GITHUB_TOKEN env
  // fallback configured. Repo listing/picking requires a real session.
  oauthConnected?: boolean;
  // GitHub login when connected via the OAuth web flow; null otherwise.
  username: string | null;
  // Whether the backend has an OAuth App configured — false means the UI
  // offers the manual-token field instead of the "Connect GitHub" redirect.
  oauthAvailable: boolean;
  avatar?: string | null;
  repositoryCount?: number | null;
  expiresAt?: string | null;
}

export interface GithubRepository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  permissions: Record<string, boolean>;
}

export interface GithubRepositoriesResponse {
  repositories: GithubRepository[];
}

export interface GithubBranch {
  name: string;
  protected: boolean;
}

export interface GithubBranchesResponse {
  branches: GithubBranch[];
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

// GET /llm/providers — every configured provider (API key set), so the
// landing composer's model selector can offer a real choice instead of a
// decorative pill. Under MOCK_CODEX this is always a single "mock" entry.
export interface LlmProvider {
  name: string;
  model: string;
}

export interface LlmProvidersResponse {
  providers: LlmProvider[];
  active: string | null;
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

// Terminal failures that are NOT engineering-judgement calls (blocked /
// generation_failed / system_error) — deliberately a separate event from
// unit_escalated so the human Review queue never has to filter these out.
export interface UnitBlockedEvent {
  unitId: string;
  status: string;
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
  | { event: "unit_blocked"; data: UnitBlockedEvent }
  | { event: "campaign_completed"; data: CampaignCompletedEvent }
  | { event: "campaign_failed"; data: CampaignFailedEvent };
