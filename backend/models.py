"""Pydantic models mirroring the section 7 contracts exactly (camelCase)."""

from pydantic import BaseModel


class RepoIn(BaseModel):
    repoUrl: str
    # Optional: checkout this branch instead of the repo's default branch.
    # Only meaningful for a fresh clone (POST /repo) -- ignored otherwise.
    branch: str | None = None


class RepoOut(BaseModel):
    repoId: str
    repoUrl: str
    status: str


class CandidateOut(BaseModel):
    candidateId: str
    scopeGlobs: list[str]
    centralityScore: float
    recentActivityScore: float
    combinedScore: float
    blacklisted: bool


class CandidatesOut(BaseModel):
    repoId: str
    candidates: list[CandidateOut]


class DiscoverIn(BaseModel):
    objective: str
    # Optional override for the env-selected LLM provider — the frontend's
    # model selector (GET /llm/providers). Ignored under MOCK_CODEX.
    model: str | None = None


class LlmProviderOut(BaseModel):
    name: str
    model: str


class LlmProvidersOut(BaseModel):
    providers: list[LlmProviderOut]
    active: str | None


class RepoProfileOut(BaseModel):
    """The zero-config bootstrap profile (discovery/profiler.py) — inferred
    entirely from what's on disk, never requiring a Migration Foreman file
    to exist. fromCache=True means it was loaded from a prior successful
    campaign's optional .migration-foreman/ cache for this same clone."""

    repoId: str
    fromCache: bool
    languages: dict[str, int]
    frameworks: list[str]
    packageManager: str | None
    buildSystem: str | None
    testFramework: str | None
    sourceRoots: list[str]
    importantDirectories: list[str]
    entryPoints: list[str]
    dependencyManifests: list[str]
    ciConfig: list[str]
    dockerConfig: list[str]


class RepoSummaryOut(BaseModel):
    fileCount: int
    sourceFileCount: int
    languages: dict[str, int]
    topDirectories: list[str]
    graphNodes: int
    graphEdges: int
    mostDependedOnFiles: list[str]


class DiscoveredSeamOut(BaseModel):
    seamId: str  # discovery-local id ("seam-0"); a real seam row is only
    # created when the human approves it via POST /repo/{id}/seam
    title: str
    description: str
    executionOrder: int
    dependsOn: list[str]  # discovery-local seamIds that must run first
    beforePattern: str
    afterPattern: str
    scopeGlobs: list[str]
    invariants: list[str]
    testCommand: str | None
    risk: str  # low | medium | high
    breakingChanges: bool
    confidence: float
    reasoning: str
    groundedFiles: list[str]
    estimatedFiles: int
    occurrences: int
    repairedScope: bool


class DroppedSeamOut(BaseModel):
    title: str
    reason: str


class DiscoveryOut(BaseModel):
    repoId: str
    objective: str
    repoSummary: RepoSummaryOut
    seams: list[DiscoveredSeamOut]
    droppedSeams: list[DroppedSeamOut]
    seamCount: int
    totalEstimatedFiles: int
    overallRisk: str
    estimatedMinutes: int


class ManualSeamIn(BaseModel):
    scopeGlobs: list[str]
    beforePattern: str
    afterPattern: str
    invariants: list[str] = []
    testCommand: str


class SeamIn(BaseModel):
    candidateId: str | None = None
    manualSeam: ManualSeamIn | None = None
    # Optional overrides for the candidateId path. Precedence:
    # request body > .migration-foreman.json > inferred defaults.
    beforePattern: str | None = None
    afterPattern: str | None = None
    invariants: list[str] | None = None
    testCommand: str | None = None
    # G2 (frontend_refactor.md Phase 8): opaque planning-session capture —
    # the client's shape (objective, mode, model, grounding stats, discovery
    # reasoning...). Never interpreted server-side, only stored and echoed
    # back so the Plan page has a server source instead of localStorage-only.
    title: str | None = None
    plan: dict | None = None
    # G8 (frontend_refactor.md Phase 8, landed): the provider name from the
    # frontend's model selector (GET /llm/providers, e.g. "groq" / "codex"),
    # persisted on the seam so every execution-time call for this campaign
    # (not just the one discover() call) uses the model the human picked.
    model: str | None = None


class SeamOut(BaseModel):
    seamId: str
    scopeGlobs: list[str]
    beforePattern: str
    afterPattern: str
    invariants: list[str]
    testCommand: str
    title: str | None = None
    plan: dict | None = None
    provider: str | None = None


class CampaignIn(BaseModel):
    seamId: str


class CampaignCreatedOut(BaseModel):
    campaignId: str
    status: str
    unitCount: int


class UnitOut(BaseModel):
    unitId: str
    scopeGlob: str
    # pending | running | retrying | failed (interim, mid-attempt) |
    # passed | escalated | blocked | generation_failed | system_error
    # (terminal — see verification/gate.py for what distinguishes the last
    # four: only "escalated" belongs in the human Review queue).
    status: str
    attempt: int
    diff: str | None
    failureLog: str | None


class CampaignOut(BaseModel):
    campaignId: str
    seamId: str
    status: str
    # The seam's verification command, surfaced so the live campaign view can
    # show what every unit is being verified with (esp. when it was inferred).
    testCommand: str
    units: list[UnitOut]
    # G1 (frontend_refactor.md Phase 8): additive fields so a reloaded/
    # foreign browser (no localStorage campaignStore) can still reach the
    # blast-radius graph (via repoId) and render the full seam record.
    repoId: str
    seam: SeamOut
    createdAt: str
    completedAt: str | None = None


class CampaignSummaryOut(BaseModel):
    """G3 — one row of the campaigns list (sidebar history, server-backed)."""

    campaignId: str
    title: str | None
    status: str
    repoId: str
    repoUrl: str
    createdAt: str
    completedAt: str | None
    unitCount: int
    acceptedUnits: int
    escalatedUnits: int


class CampaignsListOut(BaseModel):
    campaigns: list[CampaignSummaryOut]


class UnitEventOut(BaseModel):
    eventId: str
    unitId: str
    scopeGlob: str
    eventType: str
    message: str
    metadata: dict | None
    createdAt: str


class CampaignEventsOut(BaseModel):
    """G4 — unit_events read API, ordered oldest-first for tail/backfill."""

    campaignId: str
    events: list[UnitEventOut]
    nextOffset: int | None


class UnitPreviewOut(BaseModel):
    unitId: str
    path: str
    fileType: str  # markdown | html | css | code
    language: str | None
    before: str | None  # file content on the base branch
    after: str | None  # file content on the campaign branch (None if not merged)
    testLog: str | None


class ApplyOut(BaseModel):
    """Result of applying a completed campaign to the local repository."""

    campaignId: str
    localPath: str
    baseBranch: str
    campaignBranch: str
    changedFiles: list[str]
    diffSummary: str
    alreadyApplied: bool
    gitCommands: list[str]
    acceptedUnits: int
    escalatedUnits: int


class FinalizeIn(BaseModel):
    # Optional UI-supplied GitHub token (connect-GitHub flow); takes
    # precedence over the GITHUB_TOKEN env var.
    githubToken: str | None = None


class FinalizeOut(BaseModel):
    campaignId: str
    prUrl: str
    acceptedUnits: int
    escalatedUnits: int


class GithubStatusOut(BaseModel):
    # True when this browser session holds an OAuth token or the backend has
    # a GITHUB_TOKEN configured; the UI can also "connect" by passing a token
    # per finalize request without either.
    connected: bool
    # True only when THIS browser has a real OAuth session (not merely a
    # GITHUB_TOKEN env fallback). Repo listing/picking requires this — an
    # env token being set doesn't mean this session can browse "your" repos.
    oauthConnected: bool = False
    # GitHub login of the OAuth-connected user (None for env-token/manual).
    username: str | None = None
    # Whether the "Connect GitHub" OAuth button can work at all (client
    # id/secret configured server-side); False = UI offers the manual field.
    oauthAvailable: bool = False
    avatar: str | None = None
    # Best-effort live count; None if it couldn't be fetched (e.g. rate limit).
    repositoryCount: int | None = None
    expiresAt: str | None = None


class AuthSessionOut(BaseModel):
    """GET /auth/session — session validation for a future frontend."""

    authenticated: bool
    username: str | None = None
    avatar: str | None = None
    githubId: int | None = None
    repositoriesAvailable: bool = False


class GithubRepositoryOut(BaseModel):
    owner: str
    name: str
    fullName: str
    defaultBranch: str
    private: bool
    permissions: dict


class GithubRepositoriesOut(BaseModel):
    repositories: list[GithubRepositoryOut]


class GithubBranchOut(BaseModel):
    name: str
    protected: bool


class GithubBranchesOut(BaseModel):
    branches: list[GithubBranchOut]


class GithubPullRequestIn(BaseModel):
    campaignId: str
    title: str | None = None
    body: str | None = None


class GithubPullRequestOut(BaseModel):
    campaignId: str
    prUrl: str
    acceptedUnits: int
    escalatedUnits: int


class GraphNodeOut(BaseModel):
    id: str
    inDegree: int


class GraphEdgeOut(BaseModel):
    source: str
    target: str


class GraphOut(BaseModel):
    repoId: str
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


# --- Phase 9: conversational chat (see chat.py) --------------------------


class ChatMessageIn(BaseModel):
    message: str
    # Optional unit this message is discussing (Batches "Discuss in chat"
    # deep link / failure-prompt reference); must belong to the campaign.
    unitRef: str | None = None


class ChatMessageOut(BaseModel):
    messageId: str
    role: str  # user | assistant | system
    content: str
    unitRef: str | None
    action: str | None
    createdAt: str


class ChatHistoryOut(BaseModel):
    campaignId: str
    messages: list[ChatMessageOut]


class ChatTurnOut(BaseModel):
    """Response to POST /campaign/{id}/chat: the persisted pair of messages."""

    campaignId: str
    userMessage: ChatMessageOut
    assistantMessage: ChatMessageOut


class ChatRetryUnitOut(BaseModel):
    """Response to POST /campaign/{id}/chat/retry-unit/{unitId} — the
    re-dispatch result plus the system chat message recording it."""

    unit: UnitOut
    systemMessage: ChatMessageOut
