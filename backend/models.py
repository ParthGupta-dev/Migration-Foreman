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


class PlanIn(BaseModel):
    intent: str


class PlanOut(BaseModel):
    repoId: str
    intent: str
    migrationName: str
    beforePattern: str
    afterPattern: str
    scopeGlobs: list[str]
    invariants: list[str]
    testCommand: str | None
    risk: str  # low | medium | high
    breakingChanges: bool
    confidence: float
    reasoning: str
    # Grounding telemetry (computed against the clone, not model estimates):
    groundedFiles: list[str]
    matchedOccurrences: int
    unsupportedFiles: list[str]
    repairedScope: bool


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
    units: list[UnitOut]


class UnitPreviewOut(BaseModel):
    unitId: str
    path: str
    fileType: str  # markdown | html | css | code
    language: str | None
    before: str | None  # file content on the base branch
    after: str | None  # file content on the campaign branch (None if not merged)
    testLog: str | None


class FinalizeOut(BaseModel):
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
