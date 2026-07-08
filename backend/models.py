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


class ManualSeamIn(BaseModel):
    scopeGlobs: list[str]
    beforePattern: str
    afterPattern: str
    invariants: list[str] = []
    testCommand: str


class SeamIn(BaseModel):
    candidateId: str | None = None
    manualSeam: ManualSeamIn | None = None


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
