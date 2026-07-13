# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Migration Foreman turns a plain-English migration goal (e.g. "Upgrade requests to httpx") into a supervised, test-verified migration campaign: an LLM planner proposes a migration spec, it's grounded against the real repo clone, execution runs each in-scope file as an isolated unit in its own git worktree, a verification gate runs the test suite per unit with retry/escalation, and accepted units are assembled into a single PR. Full flow and rationale: [README.md](README.md). Authoritative architecture/contracts/conventions doc: [PROJECT.md](PROJECT.md) (identical copy at `docs/PROJECT.md`).

## Commands

### Local dev (Docker Compose — the only supported way to run the backend)

```bash
cp .env.example .env                      # add LLM keys, or skip and use MOCK_CODEX
python scripts/setup_demo_repo.py         # generates backend/data/demo-repo (frozen demo seam)
MOCK_CODEX=1 docker compose up -d --build # postgres + backend + frontend, offline LLM mock
```

- Frontend: http://localhost:3000 · Backend: http://localhost:8000 (docs at `/docs`) · `GET /health` reports DB + active LLM provider.
- `MOCK_CODEX=1` runs the whole pipeline (planning, grounding, worktrees, test gate, retries, escalation, WS stream) with a deterministic offline stand-in for the LLM — no API key needed. Without it, set one of `OPENAI_API_KEY` (Codex), `GROQ_API_KEY`, or the generic `LLM_PROVIDER`/`LLM_API_KEY`/`LLM_BASE_URL` trio in `.env`.
- Backend container runs `uvicorn --reload` and bind-mounts `./backend`; edits to backend code hot-reload. `DATA_DIR=/data` is kept outside `/app` specifically so runtime clones/worktrees don't trigger reload storms.
- Frontend container runs `npm install && npm run dev` on every start (bind-mounts `./frontend`).
- **Backend cannot run outside Docker on this machine**: `asyncpg` has no wheels for local Windows Python; the Dockerfile pins `python:3.12-slim`.

### Driving a campaign without the frontend

```bash
python scripts/run_campaign.py --repo-url /app/data/demo-repo --intent "Migrate legacy_format to format_text"
```

Stdlib-only CLI: ingest → candidates → seam → campaign → live poll → optional `--finalize`. See [scripts/README.md](scripts/README.md) for `seed_data.py` (seeds Postgres with sample rows for frontend dev) too.

### Frontend

```bash
cd frontend && npm run dev   # or build / start / lint
```

### Tests

There is no backend/frontend unit test suite in this repo. The only test suite is inside the generated demo repo (`backend/data/demo-repo`, unittest-based) — it's what the verification gate runs as each unit's `test_command`, and `scripts/setup_demo_repo.py` itself verifies that suite passes clean before finishing.

## Architecture

### Flow

```
Repo URL → ingest + dependency graph & candidate discovery
         → AI Planning Stage (intent → LLM-proposed spec) → grounding against the real clone
         → Plan review / seam creation
         → Batch execution: one unit per file, parallel isolated git worktrees
         → Verification gate: seam's test_command per unit → pass/retry(≤3)/escalate
         → PR assembly (accepted units), escalated units listed for human follow-up
```

Three entry points into the same pipeline: **AI Plan** (intent → grounded spec, the default), **Guided** (operator hand-types the seam), **Autonomous** (picks from ranked candidates — refuses if the top candidate is blacklisted, no silent fallback override).

### Backend (`backend/`, FastAPI, single process)

- `main.py` — all REST routes + the WS endpoint. Two contract additions beyond `docs/PROJECT.md` section 7, flagged in the module docstring: `GET /repo/{id}/graph` (React Flow data) and `POST /repo/{id}/plan` (the AI Planning Stage).
- `discovery/` — Tree-sitter-adjacent parsing (shipped as regex-based import extraction, not real Tree-sitter, behind the same interface — a flagged deviation from the original plan), NetworkX dependency graph, candidate ranking (centrality × recent git activity), safety blacklist (`auth/`, `payments/`, `**/migrations/`, etc., enforced server-side).
- `planning/planner.py` — turns a natural-language intent into a spec, then grounds it against the actual clone (counts real occurrences, repairs scopes, rejects ungrounded plans) before the client ever sees it.
- `execution/` — `splitter.py` (seam scope → one unit per file), `worktree.py` (isolated git worktree per unit), `codex.py` (LLM invocation per unit, real or `MOCK_CODEX` mock), `engine.py` (orchestrates the per-campaign run loop, `asyncio.create_task`'d from `POST /campaign`, bounded by `UNIT_PARALLELISM`).
- `verification/gate.py` — runs the seam's `test_command` as a direct `shell=True` subprocess in the unit's worktree (no extra sandbox); decides accept/retry/escalate; retry re-invokes the LLM with the real failure log attached; caps at `MAX_ATTEMPTS` (default 3).
- `pr/assembler.py` — opens the PR from the campaign branch (`mf/campaign-{id[:8]}`) via the GitHub API on finalize; raises `PrCreationError` → `502 pr_creation_failed` for non-GitHub repos or a missing `GITHUB_TOKEN` (frontend falls back to aggregated diffs).
- `llm.py` — the one env-driven client every model call goes through (planner, migrator, retries, rationale streaming). Provider precedence when `LLM_PROVIDER` is unset: codex → groq → custom. `llm.describe()` powers `GET /health`'s `llm` field.
- `db.py` — single module-level `asyncpg` pool, opened on FastAPI `startup` / closed on `shutdown`; all routes share it via `db.fetchrow`/`fetch`/`execute` (no per-request session). If Postgres is unreachable at startup the app still boots so `/health` reports `degraded`.
- `repo_config.py` — optional per-repo `.migration-foreman.json` (advanced override, never a prerequisite) supplying `beforePattern`/`afterPattern`/`testCommand`/`invariants`/extra blacklist; falls back to `infer_test_command()` when absent.
- `ws.py` — `ConnectionManager` for `/ws/campaign/{id}`; server → client only (`campaign_started`, `unit_status`, `unit_reasoning`, `unit_escalated`, `campaign_completed`, `campaign_failed`). Frontend fallback if the socket drops: poll `GET /campaign/{id}` every 2s.
- Error shape is uniform everywhere: `{"error": "machine_code", "message": "human text"}`, raised as `errors.ApiError` and caught by a single exception handler in `main.py`.

### Frontend (`frontend/`, Next.js 14 App Router)

- `lib/api.ts` — typed fetch wrappers over the backend contracts; `lib/config.ts` reads `NEXT_PUBLIC_BACKEND_BASE_URL`; `lib/types.ts` mirrors the backend's data shapes.
- `hooks/useCampaignSocket.ts` — WS client for the live campaign view.
- `components/` — `PlanIntentForm`/`ManualSeamForm`/`ModeToggle` (seam creation, all three modes), `CandidateList`/`DependencyGraph` (React Flow, pre-migration blast radius + live recoloring as units resolve), `UnitStatusTable` (deliberately shows `scopeGlob` not raw `unitId` — a flagged deviation for readability), `ReasoningLog` (streams `unit_reasoning`), `EscalationPanel`, `UnitPreviewPanel` (before/after diff, rendered per file type via `GET /campaign/{id}/unit/{id}/preview`), `DiffView`, `CampaignSummaryChart` (Recharts).
- Package name in `package.json` is still `frontend_2` (leftover from a folder rename documented in `docs/PROJECT.md` section 9 — harmless, not worth "fixing" incidentally).

### Data model

`Repo → Seam → Campaign → Unit → UnitEvent`, all Postgres (`backend/schema.sql`), one row per state change on `UnitEvent` for audit/escalation review. Full field list and the locked REST/WS contracts are in [PROJECT.md](PROJECT.md) sections 6–7 — treat those as frozen; changing them requires flagging to the team per section 13.

## Conventions (from PROJECT.md section 3, binding for AI assistants too)

- Backend: `snake_case` files/functions, `PascalCase` classes. Frontend: `PascalCase` components, `use`-prefixed `camelCase` hooks, `camelCase` utils. DB: `snake_case` plural tables/columns.
- Every API error is `{"error": "...", "message": "..."}` — no other shape.
- Logging: `INFO` for lifecycle events, `WARNING` for recoverable (e.g. a unit's retry loop handling a failure), `ERROR` for unrecoverable (Codex crash, Postgres write failure, campaign marked `failed`). All logs go to stdout (`docker compose logs`); every unit status change is additionally persisted as a `UnitEvent`.
- Do not add new routes outside the documented contracts, modify the locked contracts/schema/architecture, or introduce new dependencies without flagging it — this repo came out of a hackathon with strict owner lanes (backend/orchestration vs. frontend) and a demo-lock policy (post-lock: bug fixes only, no new features/architecture/contract changes).

## Frontend redesign (active)

Frontend is being redesigned on branch `redesign/control-room`.
Before ANY frontend work, read FRONTEND_REDESIGN.md — it is the
single source of truth (tokens, IA, phases). Design authority: Sujat.
Claude Code builds each page as a static HTML mock in design/mocks/
first; Sujat iterates and approves before any React is written —
never skip straight to implementation. Two-column shell (sidebar +
content), six pages under
/campaign/[id]/. Phases 1–5 are frontend-only; Phase 6 requires
contract changes and team approval. Never use Tailwind slate/blue
defaults, gradients, or purple for escalated status.
