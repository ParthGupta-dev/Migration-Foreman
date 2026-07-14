"""Migration Foreman backend — FastAPI service exposing the section 7 contracts.

REST: POST /repo, GET /repo/{id}/candidates, POST /repo/{id}/seam,
      POST /campaign, GET /campaign/{id}, POST /campaign/{id}/finalize
WS:   /ws/campaign/{id} (server -> client events only)

Flagged contract additions (section 13 sign-off recorded; see
frontend_refactor.md for the frontend redesign that motivated the Phase 8/9
items):
- GET /repo/{id}/graph serves dependency-graph nodes/edges for the frontend's
  React Flow views; section 7 defines the graph visually but gives it no
  endpoint.
- POST /repo/{id}/discover is the AI planning pipeline (shared by AI
  Discovery and Autonomous modes): a natural-language objective goes in,
  grounded candidate seams come out, and human-confirmed seams feed the
  existing seam -> campaign pipeline.
- Phase 8 (G1-G5): seams.title/plan persisted by POST /repo/{id}/seam and
  returned via GET /campaign/{id} (which now also embeds repoId + the full
  seam); GET /campaigns (server-backed history list); GET /campaign/{id}/
  events (unit_events read API); campaigns.completed_at set by the engine.
- Phase 9: conversational chat scoped to a campaign (chat.py) --
  GET/POST /campaign/{id}/chat and the one re-dispatch action, POST
  /campaign/{id}/chat/retry-unit/{unitId}.
"""

import asyncio
import json
import logging
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse, RedirectResponse

import chat
import config
import db
import llm
import models
from auth import oauth as github_oauth_flow
from auth import session as github_session
from discovery import blacklist
from discovery import candidates as discovery
from discovery import profiler
from errors import ApiError
from execution import engine, splitter, worktree
from planning import seam_discovery
from pr import assembler, local_apply
from repo_config import (
    infer_test_command,
    infer_test_command_for_files,
    load_repo_config,
)
from services import github_service
from ws import manager

SESSION_COOKIE = "mf_session"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("migration_foreman")

app = FastAPI(title="Migration Foreman Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_BASE_URL, "http://localhost:3000"],
    # Credentialed requests carry the mf_session cookie so /github/status and
    # /finalize can see the OAuth session (origins are explicit, never "*").
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    config.REPOS_DIR.mkdir(parents=True, exist_ok=True)
    config.WORKTREES_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("LLM provider: %s", llm.describe())
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
    try:
        await db.execute("SELECT 1")
        return {"status": "ok", "db": "connected", "llm": llm.describe()}
    except Exception:
        return {"status": "degraded", "db": "unavailable", "llm": llm.describe()}


# FLAGGED contract addition (frontend Phase 2, model selector): read-only,
# additive, no schema change — lists every LLM provider with an API key set
# so the landing page composer can offer a real choice instead of a
# decorative pill. Under MOCK_CODEX there is nothing to choose between.
@app.get("/llm/providers", response_model=models.LlmProvidersOut)
async def llm_providers() -> models.LlmProvidersOut:
    if config.MOCK_CODEX:
        return models.LlmProvidersOut(
            providers=[models.LlmProviderOut(name="mock", model="mock")], active="mock"
        )
    providers = llm.list_providers()
    try:
        active = llm.active_provider().name
    except llm.LlmError:
        active = None
    return models.LlmProvidersOut(
        providers=[models.LlmProviderOut(name=p.name, model=p.model) for p in providers],
        active=active,
    )


# --- Repo ingestion -----------------------------------------------------


@app.post("/repo", response_model=models.RepoOut)
async def create_repo(body: models.RepoIn, request: Request) -> models.RepoOut:
    if not body.repoUrl.strip():
        raise ApiError(400, "repo_url_invalid", "repoUrl must be a non-empty string")

    row = await db.fetchrow(
        "INSERT INTO repos (repo_url, status) VALUES ($1, 'pulling') RETURNING repo_id",
        body.repoUrl,
    )
    repo_id = str(row["repo_id"])
    dest = _repo_path(repo_id)

    # Private repos picked from GET /github/repositories need the connected
    # session's token to clone; public repos/URLs pass through unchanged.
    # The stored/returned repoUrl is always the original (never the
    # token-bearing one) so a token never lands in the database or a log line.
    session_id = request.cookies.get(SESSION_COOKIE)
    clone_url = await github_service.authenticated_clone_url(session_id, body.repoUrl)

    # Clone synchronously: the contract has no repo polling endpoint, so the
    # response must already carry the terminal ready/failed status. Retry a few
    # times: this Docker Desktop / WSL2 host drops ~1 in 4 TCP connects to
    # GitHub (packet loss on the host network path, not an IP/MTU issue — see
    # the MTU note in docker-compose.yml), so a single attempt fails
    # intermittently even when the repo URL and credentials are perfectly fine.
    # HTTP/1.1 avoids the separate HTTP/2 mid-transfer stall on the same path.
    def clone() -> None:
        import shutil
        from git import Repo as GitRepo
        from git.exc import GitCommandError

        max_attempts = 4
        opts = ["-c", "http.version=HTTP/1.1"]
        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                if body.branch:
                    GitRepo.clone_from(clone_url, dest, branch=body.branch, multi_options=opts)
                else:
                    GitRepo.clone_from(clone_url, dest, multi_options=opts)
                return
            except GitCommandError as exc:
                last_exc = exc
                logger.warning(
                    "Repo %s clone attempt %d/%d failed: %s",
                    repo_id, attempt, max_attempts, exc,
                )
                # A partial clone leaves a non-empty dest that the next attempt
                # would refuse — clear it before retrying.
                shutil.rmtree(dest, ignore_errors=True)
        if last_exc is not None:
            raise last_exc

    try:
        await asyncio.to_thread(clone)
        status = "ready"
        logger.info("Repo %s ingested from %s", repo_id, body.repoUrl)
        repo_conf = load_repo_config(dest)
        extra_blacklist = (repo_conf or {}).get("blacklist")
        await asyncio.to_thread(
            discovery.compute_candidates, repo_id, dest, extra_blacklist
        )
        # Bootstrap the project profile now, before seam discovery ever runs.
        # No Migration Foreman file is required for this: metadata is only
        # detected (a prior .migration-foreman/ from an earlier successful
        # campaign against this same clone) as an optional cache hit; absent
        # that, the profile is inferred entirely from what's on disk.
        metadata = await asyncio.to_thread(profiler.detect_metadata, dest)
        profile, from_cache = await asyncio.to_thread(profiler.get_or_build_profile, repo_id, dest)
        logger.info(
            "Repo %s profile %s (metadata found: %s)",
            repo_id, "loaded from cache" if from_cache else "inferred fresh", metadata,
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


@app.get("/repo/{repo_id}/profile", response_model=models.RepoProfileOut)
async def get_repo_profile(repo_id: str) -> models.RepoProfileOut:
    """FLAGGED contract addition — the zero-config bootstrap profile that
    lets discovery/planning operate on a first-time repository with no
    Migration Foreman file of any kind. Regenerated on demand if the
    in-memory cache and any on-disk .migration-foreman/ cache are both
    absent (e.g. after a backend restart on a repo with no prior campaign)."""
    row = await _get_ready_repo(repo_id)
    repo_id = str(row["repo_id"])
    repo_path = _repo_path(repo_id)
    profile, from_cache = await asyncio.to_thread(
        profiler.get_or_build_profile, repo_id, repo_path
    )
    return models.RepoProfileOut(repoId=repo_id, fromCache=from_cache, **{
        key: profile.get(key) for key in (
            "languages", "frameworks", "packageManager", "buildSystem",
            "testFramework", "sourceRoots", "importantDirectories",
            "entryPoints", "dependencyManifests", "ciConfig", "dockerConfig",
        )
    })


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


@app.post("/repo/{repo_id}/discover", response_model=models.DiscoveryOut)
async def discover_seams(repo_id: str, body: models.DiscoverIn) -> models.DiscoveryOut:
    """FLAGGED contract addition — AI Seam Discovery.

    A high-level engineering objective goes in ("Modernize authentication");
    a read-only repository analysis plus grounded candidate seams come out.
    The result is advisory and stateless: nothing is written and nothing
    executes. The client presents the seams for human approval and submits
    each approved seam through the existing POST /repo/{id}/seam ->
    POST /campaign pipeline.
    """
    row = await _get_ready_repo(repo_id)
    repo_id = str(row["repo_id"])
    if not body.objective.strip():
        raise ApiError(400, "discovery_objective_invalid", "objective must be a non-empty string")

    repo_path = _repo_path(repo_id)
    try:
        discovery_result = await asyncio.to_thread(
            seam_discovery.discover_seams, repo_path, body.objective, body.model
        )
    except seam_discovery.DiscoveryError as exc:
        raise ApiError(502, "seam_discovery_failed", str(exc))

    # Verification command inference: model suggestion wins; otherwise a
    # seam-scoped inferred command (monorepo-aware). Still-None commands are
    # a legal outcome — the UI requires the human to fill them before any
    # mode (including Autonomous) can execute that seam.
    for seam in discovery_result["seams"]:
        if seam["testCommand"] is None:
            seam["testCommand"] = infer_test_command_for_files(
                repo_path, seam["groundedFiles"]
            )
    return models.DiscoveryOut(repoId=repo_id, **discovery_result)


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
        # Seam fields resolve as: request-body overrides > repo config file
        # (advanced override, no longer a prerequisite) > inferred defaults.
        repo_conf = load_repo_config(_repo_path(repo_id)) or {}
        scope_globs = cand["scopeGlobs"]
        before = body.beforePattern or repo_conf.get("beforePattern")
        after = body.afterPattern or repo_conf.get("afterPattern")
        invariants = (
            body.invariants if body.invariants is not None
            else repo_conf.get("invariants", [])
        )
        test_command = (
            body.testCommand
            or repo_conf.get("testCommand")
            or infer_test_command(_repo_path(repo_id))
        )
        if not before or not after:
            raise ApiError(
                400, "seam_patterns_missing",
                "No before/after patterns for this candidate: pass beforePattern/"
                f"afterPattern in the request body or add {config.REPO_CONFIG_FILENAME} to the repo",
            )
        if not test_command:
            raise ApiError(
                400, "seam_test_command_missing",
                "Could not infer a test command for this repo: pass testCommand "
                f"in the request body or add {config.REPO_CONFIG_FILENAME}",
            )

    seam_row = await db.fetchrow(
        "INSERT INTO seams (repo_id, scope_globs, before_pattern, after_pattern, invariants, "
        "test_command, title, plan) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING seam_id",
        repo_id, scope_globs, before, after, invariants, test_command,
        body.title, json.dumps(body.plan) if body.plan is not None else None,
    )
    return models.SeamOut(
        seamId=str(seam_row["seam_id"]),
        scopeGlobs=scope_globs,
        beforePattern=before,
        afterPattern=after,
        invariants=invariants,
        testCommand=test_command,
        title=body.title,
        plan=body.plan,
    )


# --- Campaigns ----------------------------------------------------------


@app.get("/campaigns", response_model=models.CampaignsListOut)
async def list_campaigns() -> models.CampaignsListOut:
    """G3 (frontend_refactor.md Phase 8) — server-backed campaign history for
    the sidebar widget, replacing the per-browser localStorage list."""
    rows = await db.fetch(
        """
        SELECT
            c.campaign_id, c.status, c.created_at, c.completed_at,
            s.repo_id, s.title AS seam_title, r.repo_url,
            COUNT(u.unit_id) AS unit_count,
            COUNT(u.unit_id) FILTER (WHERE u.status = 'passed') AS accepted_units,
            COUNT(u.unit_id) FILTER (WHERE u.status = 'escalated') AS escalated_units
        FROM campaigns c
        JOIN seams s ON s.seam_id = c.seam_id
        JOIN repos r ON r.repo_id = s.repo_id
        LEFT JOIN units u ON u.campaign_id = c.campaign_id
        GROUP BY c.campaign_id, s.repo_id, s.title, r.repo_url
        ORDER BY c.created_at DESC
        """
    )
    return models.CampaignsListOut(
        campaigns=[
            models.CampaignSummaryOut(
                campaignId=str(row["campaign_id"]),
                title=row["seam_title"],
                status=row["status"],
                repoId=str(row["repo_id"]),
                repoUrl=row["repo_url"],
                createdAt=row["created_at"].isoformat(),
                completedAt=row["completed_at"].isoformat() if row["completed_at"] else None,
                unitCount=row["unit_count"],
                acceptedUnits=row["accepted_units"],
                escalatedUnits=row["escalated_units"],
            )
            for row in rows
        ]
    )


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

    # Server-side blacklist gate for EVERY path (manual seams included):
    # blacklisted files never become executable units, regardless of how the
    # seam was created or what its scope globs match.
    extra_blacklist = (load_repo_config(repo_path) or {}).get("blacklist")
    allowed = [
        rel for rel in unit_files
        if not blacklist.is_blacklisted(rel, extra_blacklist)
    ]
    if not allowed:
        raise ApiError(
            400, "seam_scope_blacklisted",
            "Every file matched by this seam is blacklisted "
            "(auth/, payments/, migrations/, secrets, or repo-config blacklist)",
        )
    unit_files = allowed

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


def _seam_out(seam_row) -> models.SeamOut:
    return models.SeamOut(
        seamId=str(seam_row["seam_id"]),
        scopeGlobs=list(seam_row["scope_globs"]),
        beforePattern=seam_row["before_pattern"],
        afterPattern=seam_row["after_pattern"],
        invariants=list(seam_row["invariants"] or []),
        testCommand=seam_row["test_command"],
        title=seam_row["title"],
        plan=db.parse_jsonb(seam_row["plan"]),
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
    # G1: the full seam row (not just test_command) plus its repo_id, so a
    # reloaded/foreign browser can reach the graph and render the Plan page
    # from the server instead of localStorage.
    seam = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", campaign["seam_id"])
    return models.CampaignOut(
        campaignId=campaign_id,
        seamId=str(campaign["seam_id"]),
        status=campaign["status"],
        testCommand=seam["test_command"] if seam else "",
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
        repoId=str(seam["repo_id"]) if seam else "",
        seam=_seam_out(seam) if seam else models.SeamOut(
            seamId=str(campaign["seam_id"]), scopeGlobs=[], beforePattern="",
            afterPattern="", invariants=[], testCommand="",
        ),
        createdAt=campaign["created_at"].isoformat(),
        completedAt=campaign["completed_at"].isoformat() if campaign["completed_at"] else None,
    )


_EVENTS_DEFAULT_LIMIT = 500
_EVENTS_MAX_LIMIT = 2000


@app.get("/campaign/{campaign_id}/events", response_model=models.CampaignEventsOut)
async def get_campaign_events(
    campaign_id: str, limit: int = _EVENTS_DEFAULT_LIMIT, offset: int = 0
) -> models.CampaignEventsOut:
    """G4 (frontend_refactor.md Phase 8) — unit_events read API, ordered
    oldest-first, so Log backfill and Overview replay can use the real
    history instead of a synthesized approximation from final unit states."""
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    campaign = await db.fetchrow("SELECT campaign_id FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")

    limit = max(1, min(limit, _EVENTS_MAX_LIMIT))
    offset = max(0, offset)
    rows = await db.fetch(
        """
        SELECT e.id, e.unit_id, u.scope_glob, e.event_type, e.message, e.metadata, e.created_at
        FROM unit_events e
        JOIN units u ON u.unit_id = e.unit_id
        WHERE u.campaign_id = $1
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT $2 OFFSET $3
        """,
        campaign_id, limit, offset,
    )
    return models.CampaignEventsOut(
        campaignId=campaign_id,
        events=[
            models.UnitEventOut(
                eventId=str(row["id"]),
                unitId=str(row["unit_id"]),
                scopeGlob=row["scope_glob"],
                eventType=row["event_type"],
                message=row["message"],
                metadata=db.parse_jsonb(row["metadata"]),
                createdAt=row["created_at"].isoformat(),
            )
            for row in rows
        ],
        nextOffset=offset + limit if len(rows) == limit else None,
    )


_PREVIEW_MAX_CHARS = 200_000

_PREVIEW_TYPES = {
    ".md": ("markdown", "markdown"), ".markdown": ("markdown", "markdown"),
    ".html": ("html", "html"), ".htm": ("html", "html"),
    ".css": ("css", "css"),
    ".py": ("code", "python"), ".js": ("code", "javascript"),
    ".jsx": ("code", "jsx"), ".ts": ("code", "typescript"),
    ".tsx": ("code", "tsx"), ".mjs": ("code", "javascript"),
    ".cjs": ("code", "javascript"), ".json": ("code", "json"),
}


@app.get("/campaign/{campaign_id}/unit/{unit_id}/preview", response_model=models.UnitPreviewOut)
async def unit_preview(campaign_id: str, unit_id: str) -> models.UnitPreviewOut:
    """Before/after file contents for a unit, plus its full test output.

    `before` comes from the repo's base branch, `after` from the campaign
    branch (null until the unit has merged, e.g. escalated units). The
    frontend renders these per file type (markdown/html/css/code).
    """
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    unit_id = _require_uuid(unit_id, "unit_not_found")
    unit = await db.fetchrow(
        "SELECT * FROM units WHERE unit_id = $1 AND campaign_id = $2", unit_id, campaign_id
    )
    if unit is None:
        raise ApiError(404, "unit_not_found", f"No unit {unit_id} in campaign {campaign_id}")
    campaign = await db.fetchrow("SELECT * FROM campaigns WHERE campaign_id = $1", campaign_id)
    seam = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", campaign["seam_id"])
    repo_path = _repo_path(str(seam["repo_id"]))
    if not repo_path.is_dir():
        raise ApiError(409, "repo_missing_on_disk", "Repo clone missing; re-ingest via POST /repo")

    path = unit["scope_glob"]

    def content_at(ref: str) -> str | None:
        from shell import run_git

        result = run_git(["show", f"{ref}:{path}"], cwd=repo_path)
        return result.stdout[:_PREVIEW_MAX_CHARS] if result.ok else None

    base_branch = await asyncio.to_thread(worktree.default_branch, repo_path)
    before = await asyncio.to_thread(content_at, base_branch)
    after = await asyncio.to_thread(content_at, f"mf/campaign-{campaign_id[:8]}")

    suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    file_type, language = _PREVIEW_TYPES.get(suffix, ("code", None))
    return models.UnitPreviewOut(
        unitId=unit_id,
        path=path,
        fileType=file_type,
        language=language,
        before=before,
        after=after,
        testLog=unit["test_log"],
    )


async def _completed_campaign_context(campaign_id: str, action: str) -> dict:
    """Shared guards + data for the two publishing paths (apply / finalize)."""
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    campaign = await db.fetchrow("SELECT * FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")
    if campaign["status"] != "completed":
        raise ApiError(
            400, "campaign_not_completed",
            f"Campaign status is '{campaign['status']}'; {action} requires 'completed'",
        )

    seam = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", campaign["seam_id"])
    repo = await db.fetchrow("SELECT * FROM repos WHERE repo_id = $1", seam["repo_id"])
    repo_path = _repo_path(str(repo["repo_id"]))
    if not repo_path.is_dir():
        raise ApiError(409, "repo_missing_on_disk", "Repo clone missing; re-ingest via POST /repo")

    units = await db.fetch(
        "SELECT scope_glob, status, attempt FROM units WHERE campaign_id = $1 ORDER BY created_at",
        campaign_id,
    )
    return {
        "campaignId": campaign_id,
        "repoUrl": repo["repo_url"],
        "repoPath": repo_path,
        "campaignBranch": f"mf/campaign-{campaign_id[:8]}",
        "accepted": [unit["scope_glob"] for unit in units if unit["status"] == "passed"],
        "escalated": [
            {"scopeGlob": unit["scope_glob"], "attempt": unit["attempt"]}
            for unit in units if unit["status"] == "escalated"
        ],
    }


@app.post("/campaign/{campaign_id}/apply", response_model=models.ApplyOut)
async def apply_campaign_locally(campaign_id: str) -> models.ApplyOut:
    """Default publishing path: apply the verified changes to the local clone.

    Merges the campaign branch (accepted, test-verified units only) into the
    repo's default branch. No GitHub authentication involved — PR creation
    (POST /finalize) is the optional alternative.
    """
    ctx = await _completed_campaign_context(campaign_id, "apply")
    try:
        result = await asyncio.to_thread(
            local_apply.apply_local, ctx["repoPath"], ctx["campaignBranch"]
        )
    except local_apply.LocalApplyError as exc:
        raise ApiError(502, "local_apply_failed", str(exc))

    if result["alreadyApplied"] and not result["changedFiles"]:
        # The diff is empty once merged; the accepted units are the files.
        result["changedFiles"] = ctx["accepted"]
    return models.ApplyOut(
        campaignId=ctx["campaignId"],
        acceptedUnits=len(ctx["accepted"]),
        escalatedUnits=len(ctx["escalated"]),
        **result,
    )


@app.post("/campaign/{campaign_id}/finalize", response_model=models.FinalizeOut)
async def finalize_campaign(
    request: Request, campaign_id: str, body: models.FinalizeIn | None = None
) -> models.FinalizeOut:
    """Optional publishing path: push the campaign branch and open a GitHub PR.

    Token precedence: request body (manual-token UI) > OAuth session token
    ("Connect GitHub" flow) > GITHUB_TOKEN env var (assembler's own fallback).
    """
    ctx = await _completed_campaign_context(campaign_id, "finalize")
    session_id = request.cookies.get(SESSION_COOKIE)
    token = body.githubToken if body else None
    try:
        pr_url = await assembler.create_pr(
            ctx["repoUrl"], ctx["repoPath"], ctx["campaignBranch"],
            ctx["accepted"], ctx["escalated"],
            token=token, session_id=session_id,
        )
    except assembler.PrCreationError as exc:
        # Fallback plan: frontend shows the aggregated diffs instead.
        raise ApiError(502, "pr_creation_failed", str(exc))

    return models.FinalizeOut(
        campaignId=ctx["campaignId"],
        prUrl=pr_url,
        acceptedUnits=len(ctx["accepted"]),
        escalatedUnits=len(ctx["escalated"]),
    )


# --- Chat (Phase 9, frontend_refactor.md) --------------------------------


@app.get("/campaign/{campaign_id}/chat", response_model=models.ChatHistoryOut)
async def get_campaign_chat(campaign_id: str) -> models.ChatHistoryOut:
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    campaign = await db.fetchrow("SELECT campaign_id FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")
    return models.ChatHistoryOut(campaignId=campaign_id, messages=await chat.get_history(campaign_id))


@app.post("/campaign/{campaign_id}/chat", response_model=models.ChatTurnOut)
async def post_campaign_chat(campaign_id: str, body: models.ChatMessageIn) -> models.ChatTurnOut:
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    try:
        user_message, assistant_message = await chat.reply(campaign_id, body.message, body.unitRef)
    except chat.ChatError as exc:
        raise ApiError(502, "chat_reply_failed", str(exc))
    return models.ChatTurnOut(
        campaignId=campaign_id, userMessage=user_message, assistantMessage=assistant_message
    )


@app.post("/campaign/{campaign_id}/chat/retry-unit/{unit_id}", response_model=models.ChatRetryUnitOut)
async def retry_unit_from_chat(campaign_id: str, unit_id: str) -> models.ChatRetryUnitOut:
    """The Phase 9 re-dispatch action: retry one escalated/blocked/
    generation_failed/system_error unit through the same verification gate
    the campaign run used, triggered explicitly from the chat UI."""
    campaign_id = _require_uuid(campaign_id, "campaign_not_found")
    unit_id = _require_uuid(unit_id, "unit_not_found")
    unit_row, system_message = await chat.retry_unit(campaign_id, unit_id)
    return models.ChatRetryUnitOut(
        unit=models.UnitOut(
            unitId=str(unit_row["unit_id"]),
            scopeGlob=unit_row["scope_glob"],
            status=unit_row["status"],
            attempt=unit_row["attempt"],
            diff=unit_row["diff"],
            failureLog=unit_row["failure_log"],
        ),
        systemMessage=system_message,
    )


# --- GitHub authentication infrastructure --------------------------------
#
# Backend-owned OAuth + session + repository/PR access (see auth/, github/,
# services/github_service.py). The migration engine and PR pipeline never
# see a raw token or know whether it came from OAuth, a manually pasted
# token, or GITHUB_TOKEN — they ask services.github_service for a client.
#
# Endpoint set below matches the stable contract a future frontend consumes
# (/auth/github/login, /auth/github/callback, /auth/session, /auth/logout,
# /github/repositories, /github/repository/{owner}/{repo},
# /github/pull-request). /github/oauth/start, /github/callback, and
# /github/status are kept as aliases for the already-wired demo frontend —
# same underlying session, just a different path.


async def _oauth_start(request: Request, next: str = "/") -> RedirectResponse:
    """Redirect the browser to GitHub's authorize screen with a
    session-bound CSRF state. `next` is the frontend path to return to."""
    if not github_oauth_flow.configured():
        raise ApiError(
            400, "github_oauth_not_configured",
            "GitHub OAuth is not configured: set GITHUB_OAUTH_CLIENT_ID and "
            "GITHUB_OAUTH_CLIENT_SECRET (register an OAuth App on GitHub), or "
            "use the manual token field instead",
        )
    if not next.startswith("/"):  # only ever redirect back into our own frontend
        next = "/"
    session_id = request.cookies.get(SESSION_COOKIE) or github_session.new_session_id()
    authorize_url = github_oauth_flow.begin(session_id, next)
    response = RedirectResponse(authorize_url, status_code=302)
    response.set_cookie(SESSION_COOKIE, session_id, httponly=True, samesite="lax", path="/")
    return response


def _frontend_redirect(next_path: str, outcome: str) -> RedirectResponse:
    separator = "&" if "?" in next_path else "?"
    return RedirectResponse(
        f"{config.FRONTEND_BASE_URL}{next_path}{separator}github={outcome}",
        status_code=302,
    )


async def _oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """GitHub redirects here after the user authorizes (or cancels). Validates
    `state` (CSRF), exchanges `code` for a token, stores it server-side keyed
    by the session cookie, and bounces the browser back to the frontend.
    Every failure path redirects with ?github=<outcome> — never a raw error
    page or an uncaught exception."""
    pending = github_oauth_flow.pop_state(state) if state else None
    next_path = pending["next"] if pending else "/"

    if error:  # user cancelled / denied on the GitHub screen
        return _frontend_redirect(next_path, "cancelled")
    if pending is None or not code:
        logger.warning("GitHub callback rejected: unknown/expired state")
        return _frontend_redirect(next_path, "error")
    if request.cookies.get(SESSION_COOKIE) != pending["session"]:
        logger.warning("GitHub callback rejected: state belongs to another session")
        return _frontend_redirect(next_path, "error")

    try:
        tokens = await asyncio.to_thread(github_oauth_flow.exchange_code, code)
    except github_oauth_flow.OAuthError as exc:
        logger.error("GitHub code exchange failed: %s", exc)
        return _frontend_redirect(next_path, "error")

    github_user = await asyncio.to_thread(github_oauth_flow.fetch_user, tokens["access_token"])
    await github_session.create_session(
        pending["session"],
        github_user or {},
        tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        token_expires_in=tokens.get("expires_in"),
    )
    logger.info(
        "GitHub connected via OAuth as %s",
        (github_user or {}).get("login") or "<unknown>",
    )
    return _frontend_redirect(next_path, "connected")


app.add_api_route("/auth/github/login", _oauth_start, methods=["GET"])
app.add_api_route("/github/oauth/start", _oauth_start, methods=["GET"])
app.add_api_route("/auth/github/callback", _oauth_callback, methods=["GET"])
app.add_api_route("/github/callback", _oauth_callback, methods=["GET"])


@app.get("/auth/session", response_model=models.AuthSessionOut)
async def auth_session(request: Request) -> models.AuthSessionOut:
    """Session validation for a future frontend to poll after login."""
    session_id = request.cookies.get(SESSION_COOKIE)
    session = await github_session.get_session(session_id)
    if session is None:
        return models.AuthSessionOut(authenticated=False)
    await github_session.touch_session(session_id)  # sliding-window refresh
    return models.AuthSessionOut(
        authenticated=True,
        username=session["username"],
        avatar=session["avatarUrl"],
        githubId=session["githubId"],
        repositoriesAvailable=True,
    )


@app.post("/auth/logout")
async def auth_logout(request: Request) -> dict[str, bool]:
    session_id = request.cookies.get(SESSION_COOKIE)
    response_body = {"loggedOut": True}
    if session_id:
        await github_session.destroy_session(session_id)
    return response_body


@app.get("/github/status", response_model=models.GithubStatusOut)
async def github_status(request: Request) -> models.GithubStatusOut:
    """Whether this session (OAuth) or the backend (env GITHUB_TOKEN) can PR."""
    session_id = request.cookies.get(SESSION_COOKIE)
    session = await github_session.get_session(session_id)
    repository_count: int | None = None
    if session is not None:
        try:
            repos = await github_service.list_repositories(session_id)
            repository_count = len(repos)
        except github_service.GithubServiceError as exc:
            logger.warning("Could not fetch repository count for status: %s", exc)
    return models.GithubStatusOut(
        connected=bool(session or config.GITHUB_TOKEN),
        oauthConnected=session is not None,
        username=session["username"] if session else None,
        oauthAvailable=github_oauth_flow.configured(),
        avatar=session["avatarUrl"] if session else None,
        repositoryCount=repository_count,
        expiresAt=session["expiresAt"].isoformat() if session else None,
    )


@app.get("/github/repositories", response_model=models.GithubRepositoriesOut)
async def github_repositories(request: Request) -> models.GithubRepositoriesOut:
    session_id = request.cookies.get(SESSION_COOKIE)
    try:
        repos = await github_service.list_repositories(session_id)
    except github_service.GithubServiceError as exc:
        raise ApiError(401, "github_not_authenticated", str(exc))
    return models.GithubRepositoriesOut(
        repositories=[models.GithubRepositoryOut(**repo) for repo in repos]
    )


@app.get("/github/repository/{owner}/{repo}", response_model=models.GithubRepositoryOut)
async def github_repository(owner: str, repo: str, request: Request) -> models.GithubRepositoryOut:
    session_id = request.cookies.get(SESSION_COOKIE)
    try:
        data = await github_service.get_repository(session_id, owner, repo)
    except github_service.GithubServiceError as exc:
        raise ApiError(401, "github_not_authenticated", str(exc))
    return models.GithubRepositoryOut(**data)


@app.get("/github/repository/{owner}/{repo}/branches", response_model=models.GithubBranchesOut)
async def github_repository_branches(
    owner: str, repo: str, request: Request
) -> models.GithubBranchesOut:
    session_id = request.cookies.get(SESSION_COOKIE)
    try:
        branches = await github_service.list_branches(session_id, owner, repo)
    except github_service.GithubServiceError as exc:
        raise ApiError(401, "github_not_authenticated", str(exc))
    return models.GithubBranchesOut(
        branches=[models.GithubBranchOut(**b) for b in branches]
    )


@app.post("/github/pull-request", response_model=models.GithubPullRequestOut)
async def github_pull_request(
    body: models.GithubPullRequestIn, request: Request
) -> models.GithubPullRequestOut:
    """Create a PR for a completed campaign using the authenticated session's
    GitHub credentials — no Personal Access Token required."""
    session_id = request.cookies.get(SESSION_COOKIE)
    ctx = await _completed_campaign_context(body.campaignId, "pull-request")
    try:
        pr_url = await github_service.create_pull_request_for_campaign(
            session_id=session_id,
            repo_url=ctx["repoUrl"],
            repo_path=ctx["repoPath"],
            campaign_branch=ctx["campaignBranch"],
            accepted=ctx["accepted"],
            escalated=ctx["escalated"],
            title=body.title,
            body=body.body,
        )
    except github_service.GithubServiceError as exc:
        raise ApiError(502, "pr_creation_failed", str(exc))
    return models.GithubPullRequestOut(
        campaignId=ctx["campaignId"],
        prUrl=pr_url,
        acceptedUnits=len(ctx["accepted"]),
        escalatedUnits=len(ctx["escalated"]),
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
