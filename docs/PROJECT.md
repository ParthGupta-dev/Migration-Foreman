# Migration Foreman — Master Project Document

**File:** PROJECT.md
**Purpose:** Single source of truth for project scope, architecture, contracts, conventions, ownership, and build progress. All teammates and AI coding assistants should treat this document as the authoritative context for the project.
**Audience:** All teammates and AI coding assistants.
**Status:** Draft
**Last Updated:** 2026-07-12 — Parth (doc-vs-code drift fixes: removed dead APScheduler dependency, corrected execution-isolation and deployment claims, documented `GET /health` and DB connection lifecycle)

## Table of Contents

- [1. Overview](#1-overview)
- [2. Problem & Solution](#2-problem--solution)
- [3. Conventions](#3-conventions)
- [4. Tech Stack](#4-tech-stack)
- [5. Architecture](#5-architecture)
- [6. Data Models](#6-data-models)
- [7. Contracts](#7-contracts)
- [8. Folder Structure](#8-folder-structure)
- [9. Ownership & Build Plan](#9-ownership--build-plan)
- [10. Integration Checkpoints](#10-integration-checkpoints)
- [11. Fallback Plan](#11-fallback-plan)
- [12. Definition of Done & Demo Lock](#12-definition-of-done--demo-lock)
- [13. Change Control](#13-change-control)

---

## 1. Overview

**Project name:** Migration Foreman

**Hackathon / event:** Codex Community Hackathon — July 14, 2026, New Delhi NCR. Agentic Coding / Developer Tools track.

**Team:** Merge Conflicts

**Description:** Migration Foreman is an autonomous code migration system built on Codex. It identifies the highest-value migration target in a legacy repository, executes the migration as a supervised, test-verified campaign using parallel Codex agents in isolated git worktrees, and visualizes the entire process live — dependency graph, unit status, retries — instead of leaving engineers to review a wall of unreadable diffs. Pitch line: *"Any engineer, any repository, productive in minutes."*

---

## 2. Problem & Solution

**Core problem being solved:**
- Nobody knows where to start on a large-scale migration without a senior engineer manually scoping the work.
- AI-generated migration patches get merged on faith because the diff looks plausible, not because anyone proved it works.
- Even a successful migration produces a wall of diffs across hundreds of files that no one actually reads or understands the impact of.

**Target users:** Engineering teams stalled on framework swaps, deprecated API sweeps, or language version bumps.

**Existing gap:** Manual migration scoping doesn't scale, and AI coding assistants that patch code with no verification loop just move the risk from "nobody understood the old code" to "nobody verified the new code."

**Proposed solution:** One pipeline, three narrow capabilities, zero overlap:
- **Discover** — ranks the highest-value migration target by reading code, git history, and structural centrality together, producing a defined scope instead of requiring manual triage.
- **Execute** — splits that scope into independent units, runs a Codex agent per unit in an isolated git worktree, test-gates every unit, retries on failure with the real failure log, escalates to a human queue after 3 attempts.
- **Visualize** — renders the dependency graph before any code is touched (blast radius visible up front) and keeps it live as units pass, fail, or retry.

**Differentiators:**
- Built natively on Codex's own strengths (agents, isolated worktrees, shell-verified execution) — not a wrapper fighting the tool.
- Trust is proven, not assumed: every accepted unit has passed its real test command, not just produced a plausible-looking diff.
- The demo ends on a number, not a vibe: units migrated / verified / escalated, live, in front of judges.

---

## 3. Conventions

These rules apply across the entire codebase, regardless of who or what (human or AI) is writing the code, to prevent drift between components built by different people/sessions.

### Naming Conventions

**Frontend:**
- Components → `PascalCase` (e.g. `SeamReviewGraph.tsx`)
- Hooks → `camelCase` with `use` prefix (e.g. `useCampaignSocket.ts`)
- Utility files → `camelCase` (e.g. `formatUnitStatus.ts`)

**Backend:**
- Python files → `snake_case` (e.g. `discovery_engine.py`)
- Functions → `snake_case` (e.g. `rank_candidates()`)
- Classes → `PascalCase` (e.g. `SeamDefinition`)

**Database:**
- Tables → `snake_case`, plural (e.g. `campaigns`, `unit_events`)
- Columns → `snake_case` (e.g. `scope_glob`, `created_at`)

### Branch Naming

- `feature/frontend-dashboard`
- `feature/backend-discovery-engine`
- `feature/backend-execution-engine`
- `feature/backend-verification-gate`
- `fix/websocket-reconnect`

### Commit Format

- `feat(frontend): add live campaign dependency graph`
- `feat(backend): implement retry/escalation loop`
- `fix(backend): validate seam input mutual exclusivity`
- `docs(project): update architecture`

### Standard Error Response

All APIs follow one consistent error shape:

```json
{
  "error": "string (machine-readable error code, e.g. seam_input_invalid)",
  "message": "string (human-readable description)"
}
```

This matches the `seam_input_invalid` error already defined in section 7 for `POST /repo/{repoId}/seam`, and every other API error in the system must follow this same `error` + `message` shape.

### Logging Convention

| Level | Use For |
| --- | --- |
| `INFO` | Normal lifecycle events — repo ingested, campaign started, unit started/resolved |
| `WARNING` | Recoverable issues — a unit failed a test but the retry loop is handling it (see Fallback Plan, section 11) |
| `ERROR` | Unrecoverable failures — Codex invocation crash, Postgres write failure, campaign marked `failed` |

**Log ownership:** The backend service (owned by Parth) owns log emission for all backend, Discovery Engine, Execution Engine, and Verification Gate code paths, since these run inside the same FastAPI service.

**Storage location:** All logs go to stdout inside the backend container (captured by `docker compose logs`). Every unit status change is additionally persisted as a `UnitEvent` row in Postgres so it survives container restarts and is queryable for the campaign summary and escalation review.

### AI Assistant Rules

AI assistants working on this codebase must:
- Not create new routes outside the documented contracts in section 7.
- Not modify contracts (section 7) without team approval.
- Not introduce new dependencies without approval.
- Not modify another owner's area (see section 9) without clearly flagging it.
- Not alter architecture, schemas, or ownership assignments without approval.
- Treat this document as the source of truth.

---

## 4. Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 14 (App Router) + Tailwind + React Flow (dependency graph) + Recharts (summary stats) |
| Backend + Orchestration | FastAPI (Python) — retry/escalation loop is a plain in-process attempt loop in `verification/gate.py`, not a job scheduler |
| Code Analysis | Tree-sitter (parsing), NetworkX (dependency graph computation) |
| AI Engine | Codex via OpenAI Responses API — one agent invocation per work unit |
| Execution Isolation | Git worktrees (one per unit) only — `test_command` runs as a direct `shell=True` subprocess in the worktree, no additional container/process sandbox |
| Real-time | Native FastAPI WebSockets |
| Database | PostgreSQL (Supabase or self-hosted) — run/unit/event state |
| Graph Storage | Neo4j (optional — NetworkX in-memory is sufficient for a single hackathon-sized repo; add only if the demo repo needs persistent graph queries) |
| Git Integration | GitPython, GitHub API (PR creation, commit history read) |
| Dev Start | Docker Compose — single `docker-compose up` boots frontend + backend + Postgres containers |
| Deployment | Not yet stood up — local dev only via Docker Compose. Vercel (frontend) / Railway (backend) remain the intended targets if a deployed demo URL is needed. |

---

## 5. Architecture

### High-Level Flow

```
Repo → Discovery Engine → Seam Definition → Execution Engine → Verification Gate → Dashboard → Verified Pull Request
```

**Step by step:**
1. Operator submits a repo URL (or a repo is pre-pulled for the demo) via frontend.
2. Backend pulls the repo to the server; Discovery Engine parses it (Tree-sitter) and builds a dependency graph (NetworkX).
3. Discovery Engine scores candidate migration targets — runtime centrality (approximated via import/call-graph in-degree) crossed with recent commit activity (git log) — filtered against a safety blacklist.
4. Top-ranked candidate is presented as a **seam definition**: `{scope_globs, before_pattern, after_pattern, invariants, test_command}` — operator confirms or overrides.
5. `POST /campaign` creates a Campaign record; backend splits the seam into independent **units** (rule-based split: one unit per file/module for hackathon scope).
6. For each unit: backend creates an isolated git worktree, invokes Codex with the before/after pattern scoped to that unit's files, applies the returned diff.
7. Verification Gate runs the seam's `test_command` inside the unit's worktree.
8. Pass → unit marked `accepted`, merged back. Fail → full failure log fed back to Codex for a retry (max 3 attempts), then `escalated` to human review queue if still failing.
9. Every state change streams to frontend via WebSocket — dashboard updates live (table + dependency graph, color-coded by unit status).
10. On campaign completion → backend opens a single PR aggregating all accepted units, with escalated units listed separately in the PR description for manual follow-up.

**Modes:**
- **Guided** — operator manually defines the seam (skip Discovery Engine scoring; use for demo safety if ranking isn't stable).
- **Autonomous** — Discovery Engine selects and ranks the seam with no human input, subject to the safety blacklist.

### Component Responsibilities

- **Frontend** — Next.js dashboard: repo input, seam review/confirmation screen, live campaign view (unit table + live dependency graph + reasoning log), campaign summary view with diff viewer.
- **Backend** — FastAPI service exposing all REST and WebSocket contracts (section 7); persists `Repo`/`Seam`/`Campaign`/`Unit`/`UnitEvent` data to Postgres; assembles the final PR.
- **Discovery Engine** — parses the repo (Tree-sitter), builds the dependency graph (NetworkX), ranks candidates by centrality × recent activity, applies the safety blacklist.
- **Execution Engine** — splits the seam into units, manages isolated git worktrees, invokes Codex per unit (scoped to that unit's files), reattaches failure logs on retry.
- **Verification Gate** — runs the seam's `test_command` inside each unit's worktree, decides accept / retry / escalate, caps retries at 3.
- **Demo Target** — a real, pre-vetted open-source repository (5–10K lines) with a genuine migration opportunity (e.g. Express → Fastify), frozen after Day 0.

---

## 6. Data Models

These definitions are the single source of truth referenced by the contracts in section 7. No field should be redefined elsewhere.

### Repo

| Field | Type | Description |
| --- | --- | --- |
| `repoId` | string (UUID) | Unique identifier for the repo |
| `repoUrl` | string | URL of the repo being migrated |
| `status` | enum: `pulling` \| `ready` \| `failed` | Current ingestion status |
| `createdAt` | string (ISO8601) | When the repo was ingested |

### Seam

| Field | Type | Description |
| --- | --- | --- |
| `seamId` | string (UUID) | Unique identifier for the seam |
| `repoId` | string (UUID) | The repo this seam belongs to |
| `scopeGlobs` | string[] | File/path globs defining the seam's scope |
| `beforePattern` | string | The pattern/state being migrated away from |
| `afterPattern` | string | The target pattern/state |
| `invariants` | string[] | Conditions that must hold true after migration |
| `testCommand` | string | Command used to verify the seam's before/after states |

### Campaign

| Field | Type | Description |
| --- | --- | --- |
| `campaignId` | string (UUID) | Unique identifier for the campaign |
| `seamId` | string (UUID) | The seam this campaign is executing |
| `status` | enum: `running` \| `completed` \| `failed` | Current campaign status |
| `createdAt` | string (ISO8601) | When the campaign was created |

### Unit

| Field | Type | Description |
| --- | --- | --- |
| `unitId` | string (UUID) | Unique identifier for the unit |
| `campaignId` | string (UUID) | The campaign this unit belongs to |
| `scopeGlob` | string | The specific file/module this unit covers |
| `status` | enum: `pending` \| `running` \| `passed` \| `failed` \| `retrying` \| `escalated` | Fixed status enum — no free-text values |
| `attempt` | integer | Current retry attempt count (capped at 3 by application logic) |
| `diff` | string \| null | The diff produced by Codex for this unit |
| `failureLog` | string \| null | The most recent test failure log, if any |
| `createdAt` | string (ISO8601) | When the unit was created |

### UnitEvent

| Field | Type | Description |
| --- | --- | --- |
| `id` | string (UUID) | Unique identifier for the event |
| `unitId` | string (UUID) | The unit this event belongs to |
| `eventType` | string | Type of event (e.g. status change, retry, escalation) |
| `message` | string | Human-readable event description |
| `metadata` | object (JSONB) | Arbitrary structured metadata for the event |
| `createdAt` | string (ISO8601) | When the event occurred |

> **Note:** Campaign summary stats (accepted/escalated counts) are computed at read time via `GROUP BY status` over `units`, not stored as columns.

### Database Connection Lifecycle

- `config.DATABASE_URL` is read from the environment (`.env` locally), defaulting to `postgresql://postgres:postgres@localhost:5432/migration_foreman`; `docker-compose.yml` overrides the host to the Compose service name `postgres`.
- `db.py` holds a single module-level `asyncpg` pool (`_pool`), opened in `init_pool()` on the FastAPI `startup` event and closed in `close_pool()` on `shutdown`. If Postgres is unreachable at startup, the error is logged and the app still boots (see `GET /health` above for how to detect this).
- All routes share this one pool via `db.fetchrow` / `db.fetch` / `db.execute` — there is no per-request session or dependency-injected connection.

---

## 7. Contracts

These contracts are locked for the build. Any change requires flagging to the whole team before implementation, since frontend and backend are built in parallel against these shapes.

### REST APIs

#### `GET /health`

Liveness/readiness probe — not part of the state-changing contract surface above, but documented here for completeness.

**Response:**
```json
{ "status": "ok | degraded", "db": "connected | unavailable" }
```
`degraded`/`unavailable` means the process is up but its Postgres pool is not — every data route will 500 until Postgres recovers.

#### `POST /repo`

**Request:**
```json
{ "repoUrl": "string" }
```

**Response:**
```json
{
  "repoId": "string",
  "repoUrl": "string",
  "status": "pulling | ready | failed"
}
```

#### `GET /repo/{repoId}/candidates`

**Response:**
```json
{
  "repoId": "string",
  "candidates": [
    {
      "candidateId": "string",
      "scopeGlobs": ["string"],
      "centralityScore": 0,
      "recentActivityScore": 0,
      "combinedScore": 0,
      "blacklisted": false
    }
  ]
}
```
`blacklisted: true` candidates are included for transparency but must never be auto-selected in Autonomous mode.

#### `POST /repo/{repoId}/seam`

**Request:**
```json
{
  "candidateId": "string | null",
  "manualSeam": {
    "scopeGlobs": ["string"],
    "beforePattern": "string",
    "afterPattern": "string",
    "invariants": ["string"],
    "testCommand": "string"
  } | null
}
```
**Validation rule:** Exactly one of `candidateId` or `manualSeam` must be provided. If both or neither are provided, reject with `400` (`error: "seam_input_invalid"`).

**Response:**
```json
{
  "seamId": "string",
  "scopeGlobs": ["string"],
  "beforePattern": "string",
  "afterPattern": "string",
  "invariants": ["string"],
  "testCommand": "string"
}
```

#### `POST /campaign`

**Request:**
```json
{ "seamId": "string" }
```

**Response:**
```json
{
  "campaignId": "string",
  "status": "running",
  "unitCount": 0
}
```

#### `GET /campaign/{campaignId}`

Single source of truth for campaign state — used for initial load, page refresh/resume, and as the WebSocket fallback (polling).

**Response:**
```json
{
  "campaignId": "string",
  "seamId": "string",
  "status": "running | completed | failed",
  "units": [
    {
      "unitId": "string",
      "scopeGlob": "string",
      "status": "pending | running | passed | failed | retrying | escalated",
      "attempt": 0,
      "diff": "string | null",
      "failureLog": "string | null"
    }
  ]
}
```
`status` on a unit is a fixed enum — no free-text values, to keep frontend status badges deterministic.

#### `POST /campaign/{campaignId}/finalize`

**Response:**
```json
{
  "campaignId": "string",
  "prUrl": "string",
  "acceptedUnits": 0,
  "escalatedUnits": 0
}
```

### WebSocket Contract

**`/ws/campaign/{campaignId}`** — server → client events only.

| Event | Payload |
| --- | --- |
| `campaign_started` | `{ "campaignId": "string" }` |
| `unit_status` | `{ "unitId": "string", "status": "string", "attempt": 0 }` |
| `unit_reasoning` | `{ "unitId": "string", "text": "string" }` |
| `unit_escalated` | `{ "unitId": "string", "failureLog": "string" }` |
| `campaign_completed` | `{ "campaignId": "string" }` |
| `campaign_failed` | `{ "reason": "string" }` |

### Database Schema (PostgreSQL)

```sql
CREATE TABLE repos (
  repo_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pulling', 'ready', 'failed')) DEFAULT 'pulling',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seams (
  seam_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id        UUID NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
  scope_globs    TEXT[] NOT NULL,
  before_pattern TEXT NOT NULL,
  after_pattern  TEXT NOT NULL,
  invariants     TEXT[],
  test_command   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  campaign_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seam_id      UUID NOT NULL REFERENCES seams(seam_id),
  status       TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
  unit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  scope_glob   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'retrying', 'escalated')) DEFAULT 'pending',
  attempt      INTEGER NOT NULL DEFAULT 0,
  diff         TEXT,
  failure_log  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE unit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  message      TEXT NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for the lookups the API actually does
CREATE INDEX idx_units_campaign_id ON units(campaign_id);
CREATE INDEX idx_unit_events_unit_id ON unit_events(unit_id);
CREATE INDEX idx_seams_repo_id ON seams(repo_id);
```

**Notes:**
- `Campaign` summary stats (accepted/escalated counts) are computed at read time via `GROUP BY status` over `units`, not stored as columns.
- `attempt` on `units` caps at 3 by application logic, not a DB constraint — the constraint lives in the retry loop in the Execution Engine.

---

## 8. Folder Structure

```
root/
├── frontend/          # Next.js app — repo input, seam review, live campaign view, summary view
├── backend/           # FastAPI service — API routes, WebSocket server, Postgres connection
│   ├── discovery/      # Tree-sitter parsing, NetworkX graph build, ranking, safety blacklist
│   ├── execution/       # Unit splitting, worktree management, Codex invocation
│   ├── verification/    # Test runner wrapper, retry/escalation logic
│   └── pr/               # PR assembly via GitHub API
├── docs/               # PROJECT.md and any supporting documentation
├── deck/               # Pitch deck / demo narrative assets
├── scripts/            # Dev/ops utilities: demo repo setup, seed data, campaign runner
```

| Folder | Purpose | Owner |
| --- | --- | --- |
| `frontend/` | Repo input, seam review, live campaign view, summary view | Arushi |
| `backend/` (all subfolders) | API routes, WebSocket server, Discovery Engine, Execution Engine, Verification Gate, PR assembly, Postgres integration | Parth |
| `docs/` | PROJECT.md and related documentation | Shared — see section 13 (Change Control) |
| `deck/` | Pitch deck, demo script, closing-slide numbers | Tanvi |
| `scripts/` | Dev/ops utilities: demo repo setup, seed data, campaign runner | Parth |

---

## 9. Ownership & Build Plan

This is the team's live project tracker. Each person checks off tasks/subtasks as they complete them so both teammates and AI assistants can see current state at a glance.

### Parth — Backend, Orchestration & Everything Non-Frontend

**Responsibilities:** FastAPI scaffolding, REST + WebSocket contracts, Discovery Engine, Execution Engine, Verification Gate, PR assembly, audit trail, Postgres integration, Docker/dev infra, demo repo prep.

**Dependencies:** Frontend must consume the contracts in section 7 exactly as defined (Arushi).

**Do Not Modify:** `frontend/` without flagging it to Arushi first.

**Build Tracker:**

- [x] Project scaffolding
  - [x] Init FastAPI project
  - [x] Configure native WebSocket server
  - [x] Connect to PostgreSQL
  - [x] Set up env config (.env + dotenv)
  - [x] Write Dockerfile (install Tree-sitter, git, test runners for the demo repo's stack)
  - [x] Write docker-compose.yml (frontend + backend + Postgres)

- [x] Repo ingestion
  - [x] `POST /repo` endpoint — pulls target repo to the server, stores `Repo` record
  - [x] Trigger Discovery Engine parse + graph build on ingestion

- [x] Discovery Engine (safety-critical — build last, gate carefully)
  - [x] Tree-sitter parse of target repo — extract file/module structure and import relationships *(shipped as regex-based import extraction behind the same interface — see flagged deviations)*
  - [x] Build dependency graph with NetworkX — nodes = files/modules, edges = imports/calls
  - [x] Compute recent-commit-activity score per file (git log frequency, recency-weighted)
  - [x] Compute centrality score per file (in-degree in the import/call graph)
  - [x] Rank candidates by centrality × recent activity
  - [x] `GET /repo/{id}/candidates` endpoint — returns ranked seam candidates
  - [x] Safety blacklist: `auth/`, `payments/`, `**/migrations/`, common secrets/config patterns — configurable per repo, applied before candidates are ever shown or auto-selected
  - [x] Autonomous mode refuses to proceed if the top-ranked candidate is blacklisted — falls back to next candidate, never silently overrides the blacklist (enforced server-side: `400 candidate_blacklisted`)
  - [x] `POST /repo/{id}/seam` endpoint — operator confirms or submits a manual seam definition

- [x] Execution Engine
  - [x] Rule-based unit split of seam scope (one unit per file/directory for hackathon scope)
  - [x] Isolated git worktree creation per unit, cleanup after unit resolution
  - [x] Per-unit Codex invocation — scoped to unit's files, given before/after pattern + invariants
  - [x] Retry invocation — same call, with failure log appended as additional context

- [x] Verification Gate
  - [x] Test runner wrapper — executes seam's `test_command` inside a unit's worktree, captures stdout/stderr
  - [x] Retry loop — on failure, feed log back to Codex, re-invoke, increment attempt count, cap at 3
  - [x] Escalation logic — after 3 failed attempts, mark unit `escalated`, store failure log

- [x] Campaign management
  - [x] `POST /campaign` endpoint — validates seam, splits into units, creates Campaign + Unit records, triggers Execution Engine
  - [x] `GET /campaign/{id}` endpoint — returns current campaign status and all unit states
  - [x] Campaign status updates streamed via WebSocket

- [x] PR assembly
  - [x] `POST /campaign/{id}/finalize` endpoint — merges all accepted units, opens PR via GitHub API, lists escalated units in PR description (non-GitHub repo or missing token → `502 pr_creation_failed`, summary falls back to diffs per section 11)

- [x] Audit trail
  - [x] Store `UnitEvent` on every status change (pending → running → passed/failed/retrying/escalated)

- [ ] Demo repo prep
  - [ ] Choose and freeze the demo repo — no swapping after Day 0 *(generated candidate ready via `scripts/setup_demo_repo.py`; freeze is a team call)*
  - [x] Confirm the repo's test suite runs cleanly on a fresh pull, no flaky tests
  - [x] Manually verify the seam's `test_command` distinguishes before/after state
  - [x] Manually run the migration once end-to-end before demo day *(full run verified: 3 passed, 1 escalated, live WS stream, finalize fallback)*

---

### Arushi — Frontend

**Responsibilities:** Next.js dashboard, repo input, seam review/confirmation screen, live campaign view, campaign summary view.

**Dependencies:** Backend REST endpoints and the `/ws/campaign/{campaignId}` WebSocket contract (section 7); data shapes from section 6.

**Do Not Modify:** `backend/`, database schema, API/WebSocket contracts (section 7) without team approval.

> **Resolved (2026-07-13):** this was originally built in a `frontend_2/` folder. The old untouched `create-next-app` scaffold has since been removed and `frontend_2/` renamed to `frontend/`, so the folder structure in section 8 is accurate again.

**Build Tracker:**

- [x] Project scaffolding
  - [x] Init Next.js 14 with App Router
  - [x] Configure Tailwind + React Flow + Recharts
  - [x] Set up native WebSocket client
  - [x] Connect to backend base URL via env variable

- [x] Repo Input & Seam Review view
  - [x] Repo URL input field (or pre-loaded demo repo selector)
  - [x] Mode selector — Guided / Autonomous
  - [x] Seam definition display — scope globs, before/after pattern, invariants, test command
  - [x] Pre-migration dependency graph — React Flow, nodes = files/modules, edges = dependencies, highlight blast radius
  - [x] Confirm / Edit seam button before campaign starts

- [x] Live Campaign view
  - [x] Unit status table — status, attempt count *(shows `scopeGlob` as the unit identifier instead of raw `unitId`, for readability — flagged deviation)*
  - [x] Live dependency graph — same graph as seam review, nodes recolor as units resolve
  - [x] Mini terminal/log panel — streams Codex reasoning + tool output per active unit *(built and wired to `unit_reasoning`; not visually confirmed with live text in the verification pass since the demo campaign resolved very fast)*
  - [x] Escalation panel — lists units that hit max retries, shows diff + failure log per escalated unit

- [x] Campaign Summary view
  - [x] Final tally — units passed / failed / escalated
  - [x] Link to opened PR *(wired to `POST /campaign/{id}/finalize`; not click-tested in verification to avoid a real GitHub push against a repo we don't own)*
  - [x] Per-unit diff viewer (accepted and escalated units)

---

### Tanvi — Presentation

**Responsibilities:** Pitch deck, demo narrative, slide sequencing. Coordinates with Parth and Arushi to pull the actual closing-slide numbers (units migrated / verified / escalated) from a real rehearsal run rather than placeholder figures.

**Dependencies:** Needs a completed rehearsal (Checkpoint 8, section 10) before the deck's numbers can be finalized.

**Do Not Modify:** No code ownership — works in `deck/` only.

**Build Tracker:**
- [ ] Deck outline (problem → solution → how it works → live demo → why this wins)
- [ ] Draft slides using placeholder numbers
- [ ] Swap in real numbers after full rehearsal (section 10, Checkpoint 8)
- [ ] Time the pitch to fit the slot alongside the live demo

---

## 10. Integration Checkpoints

### Checkpoint 1 — Frontend ↔ Backend connectivity
- **Required completed components:** Backend project scaffolding (Parth); frontend project scaffolding with env-configured backend base URL (Arushi).
- **Validation criteria:** Frontend can successfully call a basic backend endpoint and receive a response.
- **Expected output:** A confirmed network path between the two services with no CORS/connection errors.

### Checkpoint 2 — Repo ingestion & Discovery Engine
- **Required completed components:** `POST /repo` + Discovery Engine parse/graph build (Parth).
- **Validation criteria:** Submitting a real repo URL produces a ranked candidate list via `GET /repo/{id}/candidates`.
- **Expected output:** At least one non-blacklisted candidate returned with a computed `combinedScore`.

### Checkpoint 3 — Seam confirmation flow
- **Required completed components:** `POST /repo/{id}/seam` (Parth); Seam Review view (Arushi).
- **Validation criteria:** Operator can confirm a candidate or submit a manual seam, and the seam is stored correctly.
- **Expected output:** A valid `Seam` record with all required fields populated.

### Checkpoint 4 — Campaign creation & Execution Engine
- **Required completed components:** `POST /campaign` + unit splitting + worktree/Codex invocation (Parth).
- **Validation criteria:** Creating a campaign produces the expected unit count, and at least one unit executes a real Codex call in an isolated worktree.
- **Expected output:** A campaign transitions to `running` with observable unit activity in logs.

### Checkpoint 5 — Verification Gate (retry/escalation loop)
- **Required completed components:** Test runner wrapper + retry loop + escalation logic (Parth).
- **Validation criteria:** A deliberately failing unit retries up to 3 times and then escalates correctly.
- **Expected output:** A `UnitEvent` trail showing the full pending → running → failed → retrying → escalated sequence.

### Checkpoint 6 — Live dashboard
- **Required completed components:** WebSocket streaming (Parth); Live Campaign view rendering the stream (Arushi).
- **Validation criteria:** Unit status table and dependency graph update in real time as a campaign runs, with no manual refresh.
- **Expected output:** A visibly live dashboard during an actual campaign run.

### Checkpoint 7 — PR assembly
- **Required completed components:** `POST /campaign/{id}/finalize` (Parth); Campaign Summary view with PR link (Arushi).
- **Validation criteria:** A completed campaign produces a real PR aggregating accepted units, with escalated units listed separately.
- **Expected output:** A working PR URL visible in the Campaign Summary view.

### Checkpoint 8 — Full demo rehearsal
- **Required completed components:** All of the above, plus the frozen demo repo (Parth) and the deck (Tanvi).
- **Validation criteria:** A complete run-through — repo ingest → seam review → campaign → live dashboard → PR — completes successfully within the demo time slot, including at least one deliberately triggered retry.
- **Expected output:** A timed, successful rehearsal, with a backup recording.

---

## 11. Fallback Plan

| If… fails | Fallback action | Impact |
| --- | --- | --- |
| Discovery Engine ranking fails or looks unsafe | Switch to Guided mode — operator manually defines the seam, campaign still runs and verifies normally | Loses the "autonomous discovery" story beat, verification story stays intact |
| Codex API fails mid-unit | Retry loop treats it as a failed attempt — same 3-retry/escalate path handles it, no special-casing needed | No loss of functionality, just consumes a retry |
| WebSocket fails | Polling — frontend polls `GET /campaign/{id}` every 2 seconds | Live feed becomes near-real-time instead of instant |
| Parallel worktree execution fails | Fall back to sequential unit processing | Slower, but the verification loop still holds end-to-end |
| Dependency graph rendering fails | Fall back to the plain unit status table | Still shows real progress, just without the visual graph |
| PR creation via GitHub API fails | Present the aggregated diff directly in the Campaign Summary view | PR creation mentioned as a completed-but-not-demoed step |

---

## 12. Definition of Done & Demo Lock

**Demo-ready checklist:**
- [ ] End-to-end campaign works (repo ingest → seam review → campaign → live dashboard → PR)
- [ ] Discovery Engine produces a real, non-trivial ranked candidate on the frozen demo repo
- [ ] At least one retry scenario has been deliberately triggered and confirmed to converge
- [ ] Escalation path confirmed (a unit can actually reach `escalated` status)
- [ ] PR assembly works (`POST /campaign/{id}/finalize`)
- [ ] Demo repo frozen, test suite confirmed clean with no flaky tests
- [ ] Full rehearsal completed and timed to fit the demo slot, with a backup recording
- [ ] Deck finalized with real (not placeholder) closing numbers

**Demo lock policy:** Once the checklist above is fully complete and the full rehearsal (Checkpoint 8, section 10) has passed, the project enters demo lock.

**After demo lock:**
- ✅ Bug fixes allowed
- ❌ No new features
- ❌ No architecture changes
- ❌ No contract changes

---

## 13. Change Control

- PROJECT.md is the repository source of truth.
- Architecture changes (section 5) require team approval.
- Contract changes (section 7) require team approval.
- Schema changes (section 6 / database schema in section 7) require team approval.
- Ownership changes (section 9) require team approval.
- Any approved change must be reflected immediately in the relevant section of this document.
- No silent edits to shared project context — if a change affects another teammate's work, that teammate must be informed before the document is updated.
