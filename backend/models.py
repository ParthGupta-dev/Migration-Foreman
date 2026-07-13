"""Pydantic models mirroring the section 7 contracts exactly (camelCase)."""

from pydantic import BaseModel


class RepoIn(BaseModel):
    repoUrl: str


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


class SeamOut(BaseModel):
    seamId: str
    scopeGlobs: list[str]
    beforePattern: str
    afterPattern: str
    invariants: list[str]
    testCommand: str


class CampaignIn(BaseModel):
    seamId: str


class CampaignCreatedOut(BaseModel):
    campaignId: str
    status: str
    unitCount: int


class UnitOut(BaseModel):
    unitId: str
    scopeGlob: str
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
