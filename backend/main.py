"""Migration Foreman backend — FastAPI service exposing the section 7 contracts.

REST: POST /repo, GET /repo/{id}/candidates, POST /repo/{id}/seam,
      POST /campaign, GET /campaign/{id}, POST /campaign/{id}/finalize
WS:   /ws/campaign/{id} (server -> client events only)

Flagged contract addition (needs team approval, section 13): GET
/repo/{id}/graph serves dependency-graph nodes/edges for the frontend's
React Flow views; section 7 defines the graph visually but gives it no
endpoint.
"""

import asyncio
import logging
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

import config
import db
import models
from discovery import candidates as discovery
from errors import ApiError
from execution import engine, splitter
from pr import assembler
from repo_config import load_repo_config
from ws import manager

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("migration_foreman")

app = FastAPI(title="Migration Foreman Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_BASE_URL, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    config.REPOS_DIR.mkdir(parents=True, exist_ok=True)
    config.WORKTREES_DIR.mkdir(parents=True, exist_ok=True)
    try:
        await db.init_pool()
    except Exception as exc:
        # Boot anyway so /health works; every data route will 500 clearly.
        logger.error("Postgres unavailable at startup: %s", exc)


@app.on_event("shutdown")
async def shutdown() -> None:
    await db.close_pool()


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code, content={"error": exc.error, "message": exc.message}
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400, content={"error": "validation_error", "message": str(exc.errors()[:3])}
    )


def _require_uuid(value: str, error_code: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError(404, error_code, f"Invalid id: {value}")


def _repo_path(repo_id: str):
    return config.REPOS_DIR / repo_id


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Repo ingestion -----------------------------------------------------


@app.post("/repo", response_model=models.RepoOut)
async def create_repo(body: models.RepoIn) -> models.RepoOut:
    if not body.repoUrl.strip():
        raise ApiError(400, "repo_url_invalid", "repoUrl must be a non-empty string")

    row = await db.fetchrow(
        "INSERT INTO repos (repo_url, status) VALUES ($1, 'pulling') RETURNING repo_id",
        body.repoUrl,
    )
    repo_id = str(row["repo_id"])
    dest = _repo_path(repo_id)

    # Clone synchronously: the contract has no repo polling endpoint, so the
    # response must already carry the terminal ready/failed status.
    def clone() -> None:
        from git import Repo as GitRepo

        GitRepo.clone_from(body.repoUrl, dest)

    try:
        await asyncio.to_thread(clone)
        status = "ready"
        logger.info("Repo %s ingested from %s", repo_id, body.repoUrl)
        repo_conf = load_repo_config(dest)
        extra_blacklist = (repo_conf or {}).get("blacklist")
        await asyncio.to_thread(
            discovery.compute_candidates, repo_id, dest, extra_blacklist
        )
    except Exception as exc:
        status = "failed"
        logger.error("Repo %s ingestion failed: %s", repo_id, exc)

    await db.execute("UPDATE repos SET status = $1 WHERE repo_id = $2", status, repo_id)
    return models.RepoOut(repoId=repo_id, repoUrl=body.repoUrl, status=status)


async def _get_ready_repo(repo_id: str):
    repo_id = _require_uuid(repo_id, "repo_not_found")
    row = await db.fetchrow("SELECT * FROM repos WHERE repo_id = $1", repo_id)
    if row is None:
        raise ApiError(404, "repo_not_found", f"No repo with id {repo_id}")
    if row["status"] != "ready":
        raise ApiError(409, "repo_not_ready", f"Repo status is '{row['status']}', not 'ready'")
    return row


@app.get("/repo/{repo_id}/candidates", response_model=models.CandidatesOut)
async def get_candidates(repo_id: str) -> models.CandidatesOut:
    row = await _get_ready_repo(repo_id)
    repo_id = str(row["repo_id"])
    cands = await asyncio.to_thread(discovery.get_candidates, repo_id, _repo_path(repo_id))
    return models.CandidatesOut(
        repoId=repo_id,
        candidates=[
            models.CandidateOut(**{key: cand[key] for key in (
                "candidateId", "scopeGlobs", "centralityScore",
                "recentActivityScore", "combinedScore", "blacklisted",
            )})
            for cand in cands
        ],
    )


@app.get("/repo/{repo_id}/graph", response_model=models.GraphOut)
async def get_graph(repo_id: str) -> models.GraphOut:
    """FLAGGED contract addition — dependency graph data for React Flow."""
    row = await _get_ready_repo(repo_id)
    repo_id = str(row["repo_id"])
    graph = await asyncio.to_thread(discovery.get_graph, repo_id, _repo_path(repo_id))
    return models.GraphOut(
        repoId=repo_id,
        nodes=[
            models.GraphNodeOut(id=node, inDegree=graph.in_degree(node))
            for node in graph.nodes
        ],
        edges=[models.GraphEdgeOut(source=src, target=dst) for src, dst in graph.edges],
    )


@app.post("/repo/{repo_id}/seam", response_model=models.SeamOut)
async def create_seam(repo_id: str, body: models.SeamIn) -> models.SeamOut:
    row = await _get_ready_repo(repo_id)
    repo_id = str(row["repo_id"])

    # Locked validation rule: exactly one of candidateId | manualSeam.
    if (body.candidateId is None) == (body.manualSeam is None):
        raise ApiError(
            400, "seam_input_invalid",
            "Provide exactly one of candidateId or manualSeam",
        )

    if body.manualSeam is not None:
        seam = body.manualSeam
        scope_globs = seam.scopeGlobs
        before, after = seam.beforePattern, seam.afterPattern
        invariants, test_command = seam.invariants, seam.testCommand
    else:
        cand = await asyncio.to_thread(
            discovery.get_candidate, repo_id, _repo_path(repo_id), body.candidateId
        )
        if cand is None:
            raise ApiError(404, "candidate_not_found", f"No candidate {body.candidateId}")
        if cand["blacklisted"]:
            # Blacklist is enforced server-side so Autonomous mode can never
            # silently override it.
            raise ApiError(
                400, "candidate_blacklisted",
                "Candidate touches blacklisted paths and cannot be selected",
            )
        repo_conf = load_repo_config(_repo_path(repo_id))
        if repo_conf is None:
            raise ApiError(
                400, "seam_config_missing",
                f"Repo has no {config.REPO_CONFIG_FILENAME}; submit a manualSeam instead",
            )
        scope_globs = cand["scopeGlobs"]
        before, after = repo_conf["beforePattern"], repo_conf["afterPattern"]
        invariants, test_command = repo_conf["invariants"], repo_conf["testCommand"]

    seam_row = await db.fetchrow(
        "INSERT INTO seams (repo_id, scope_globs, before_pattern, after_pattern, invariants, test_command) "
        "VALUES ($1, $2, $3, $4, $5, $6) RETURNING seam_id",
        repo_id, scope_globs, before, after, invariants, test_command,
    )
    return models.SeamOut(
        seamId=str(seam_row["seam_id"]),
        scopeGlobs=scope_globs,
        beforePattern=before,
        afterPattern=after,
        invariants=invariants,
        testCommand=test_command,
    )


# --- Campaigns ----------------------------------------------------------


@app.post("/campaign", response_model=models.CampaignCreatedOut)
async def create_campaign(body: models.CampaignIn) -> models.CampaignCreatedOut:
    seam_id = _require_uuid(body.seamId, "seam_not_found")
    seam_row = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", seam_id)
    if seam_row is None:
        raise ApiError(404, "seam_not_found", f"No seam with id {seam_id}")

    repo_id = str(seam_row["repo_id"])
    repo_path = _repo_path(repo_id)
    if not repo_path.is_dir():
        raise ApiError(409, "repo_missing_on_disk", "Repo clone missing; re-ingest via POST /repo")

    unit_files = await asyncio.to_thread(
        splitter.split_units, repo_path, list(seam_row["scope_globs"])
    )
    if not unit_files:
        raise ApiError(400, "seam_scope_empty", "Seam scope globs matched no files")

    campaign_row = await db.fetchrow(
        "INSERT INTO campaigns (seam_id, status) VALUES ($1, 'running') RETURNING campaign_id",
        seam_id,
    )
    campaign_id = str(campaign_row["campaign_id"])
    for rel_path in unit_files:
        unit_row = await db.fetchrow(
            "INSERT INTO units (campaign_id, scope_glob, status) VALUES ($1, $2, 'pending') RETURNING unit_id",
            campaign_id, rel_path,
        )
        await db.record_unit_event(str(unit_row["unit_id"]), "created", f"Unit created for {rel_path}")

    seam = {
        "beforePattern": seam_row["before_pattern"],
        "afterPattern": seam_row["after_pattern"],
        "invariants": list(seam_row["invariants"] or []),
        "testCommand": seam_row["test_command"],
    }
    asyncio.create_task(engine.run_campaign(campaign_id, seam, repo_path))

    return models.CampaignCreatedOut(
        campaignId=campaign_id, status="running", unitCount=len(unit_files)
    )


@app.get("/campaign/{campaign_id}", response_model=models.CampaignOut)
async def get_campaign(campaign_id: str) -> models.CampaignOut:
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    campaign = await db.fetchrow("SELECT * FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")
    units = await db.fetch(
        "SELECT * FROM units WHERE campaign_id = $1 ORDER BY created_at", campaign_id
    )
    return models.CampaignOut(
        campaignId=campaign_id,
        seamId=str(campaign["seam_id"]),
        status=campaign["status"],
        units=[
            models.UnitOut(
                unitId=str(unit["unit_id"]),
                scopeGlob=unit["scope_glob"],
                status=unit["status"],
                attempt=unit["attempt"],
                diff=unit["diff"],
                failureLog=unit["failure_log"],
            )
            for unit in units
        ],
    )


@app.post("/campaign/{campaign_id}/finalize", response_model=models.FinalizeOut)
async def finalize_campaign(campaign_id: str) -> models.FinalizeOut:
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    campaign = await db.fetchrow("SELECT * FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")
    if campaign["status"] != "completed":
        raise ApiError(
            400, "campaign_not_completed",
            f"Campaign status is '{campaign['status']}'; finalize requires 'completed'",
        )

    seam = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", campaign["seam_id"])
    repo = await db.fetchrow("SELECT * FROM repos WHERE repo_id = $1", seam["repo_id"])
    repo_path = _repo_path(str(repo["repo_id"]))

    units = await db.fetch(
        "SELECT scope_glob, status, attempt FROM units WHERE campaign_id = $1 ORDER BY created_at",
        campaign_id,
    )
    accepted = [unit["scope_glob"] for unit in units if unit["status"] == "passed"]
    escalated = [
        {"scopeGlob": unit["scope_glob"], "attempt": unit["attempt"]}
        for unit in units if unit["status"] == "escalated"
    ]

    campaign_branch = f"mf/campaign-{campaign_id[:8]}"
    try:
        pr_url = await asyncio.to_thread(
            assembler.create_pr, repo["repo_url"], repo_path, campaign_branch, accepted, escalated
        )
    except assembler.PrCreationError as exc:
        # Fallback plan: frontend shows the aggregated diffs instead.
        raise ApiError(502, "pr_creation_failed", str(exc))

    return models.FinalizeOut(
        campaignId=campaign_id,
        prUrl=pr_url,
        acceptedUnits=len(accepted),
        escalatedUnits=len(escalated),
    )


# --- WebSocket ----------------------------------------------------------


@app.websocket("/ws/campaign/{campaign_id}")
async def campaign_ws(websocket: WebSocket, campaign_id: str) -> None:
    await manager.connect(campaign_id, websocket)
    try:
        while True:
            # Server -> client only; drain (and ignore) any client frames.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(campaign_id, websocket)
