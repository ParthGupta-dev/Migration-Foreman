# Migration Foreman — Build Plan
**Team: Merge Conflicts | Codex Community Hackathon, NCR**

---

## 1. Project Overview

Migration Foreman is an autonomous code migration system built on Codex. It identifies the highest-value migration target in a legacy repository, executes the migration as a supervised, test-verified campaign using parallel Codex agents in isolated git worktrees, and visualizes the entire process live — dependency graph, unit status, retries — instead of leaving engineers to review a wall of unreadable diffs.

Built for the Codex Community Hackathon, New Delhi NCR, July 14, 2026. Agentic Coding / Developer Tools track.

---

## 2. Tech Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind + React Flow (dependency graph) + Recharts (summary stats) |
| Backend + Orchestration | FastAPI (Python) + APScheduler (retry/escalation scheduling) |
| Code Analysis | Tree-sitter (parsing), NetworkX (dependency graph computation) |
| AI Engine | Codex via OpenAI Responses API — one agent invocation per work unit |
| Execution Isolation | Git worktrees (one per unit), Docker sandbox for running tests |
| Real-time | Native FastAPI WebSockets |
| Database | PostgreSQL (Supabase or self-hosted) — run/unit/event state |
| Graph Storage | Neo4j (optional — NetworkX in-memory is sufficient for a single hackathon-sized repo; add Neo4j only if the demo repo is large enough to need persistent graph queries) |
| Git Integration | GitPython, GitHub API (PR creation, commit history read) |
| Dev Start | Docker Compose — single `docker-compose up` boots frontend + backend + Postgres containers |
| Deployment | Vercel (frontend), Railway (backend) |

---

## 3. Architecture

**Component Flow:** Repo → Discovery Engine → Seam Definition → Execution Engine → Verification Gate → Dashboard → Verified Pull Request

**Step by step:**

1. Operator submits a repo URL (or a repo is pre-pulled for the demo) via frontend
2. Backend clones the repo, Discovery Engine parses it (Tree-sitter) and builds a dependency graph (NetworkX)
3. Discovery Engine scores candidate migration targets — runtime centrality (approximated via import/call-graph in-degree) crossed with recent commit activity (git log) — filtered against a safety blacklist
4. Top-ranked candidate is presented as a **seam definition**: `{scope_globs, before_pattern, after_pattern, invariants, test_command}` — operator confirms or overrides
5. `POST /campaign` creates a Campaign record, backend splits the seam into independent **units** (rule-based split: one unit per file/module for hackathon scope)
6. For each unit: backend creates an isolated git worktree, invokes Codex with the before/after pattern scoped to that unit's files, applies the returned diff
7. Verification Gate runs the seam's `test_command` inside the unit's worktree
8. Pass → unit marked `accepted`, merged back. Fail → full failure log fed back to Codex for a retry (max 3 attempts), then `escalated` to human review queue if still failing
9. Every state change streams to frontend via WebSocket — dashboard updates live (table + dependency graph, color-coded by unit status)
10. On campaign completion → backend opens a single PR aggregating all accepted units, escalated units listed separately in the PR description for manual follow-up

**Modes:**
- **Guided** — operator manually defines the seam (skip Discovery Engine scoring, use for demo safety if ranking isn't stable)
- **Autonomous** — Discovery Engine selects and ranks the seam with no human input, subject to the safety blacklist

**Services:**
- Frontend (Next.js) — dashboard, seam review/confirmation screen, live campaign view, dependency graph
- Backend (FastAPI) — API routes, Discovery Engine, Execution Engine, Verification Gate, WebSocket server, Postgres connection

---

## 4. Tasks & Subtasks

### 4.1 Frontend

> **Resolved (2026-07-13):** this was originally built in `frontend_2/`. The old untouched scaffold has since been removed and `frontend_2/` renamed to `frontend/`.

- [x] Project scaffolding
  - [x] Init Next.js 14 with App Router
  - [x] Configure Tailwind + React Flow + Recharts
  - [x] Set up native WebSocket client
  - [x] Connect to backend base URL via env variable

- [x] Repo Input & Seam Review view
  - [x] Repo URL input field (or pre-loaded demo repo selector)
  - [x] Mode selector — Guided / Autonomous
  - [x] Seam definition display — scope globs, before/after pattern, invariants, test command
  - [x] Pre-migration dependency graph — React Flow, nodes = files/modules, edges = dependencies, highlight blast radius of the proposed seam
  - [x] Confirm / Edit seam button before campaign starts

- [x] Live Campaign view
  - [x] Unit status table — status (pending/running/passed/failed/retrying/escalated), attempt count *(shows `scopeGlob` instead of raw `unitId` as the row identifier — flagged deviation)*
  - [x] Live dependency graph — same graph as seam review, nodes recolor as units resolve
  - [x] Mini terminal/log panel — streams Codex reasoning + tool output per active unit *(wired to `unit_reasoning`; not visually confirmed with live text since the verification campaign resolved before much reasoning text streamed)*
  - [x] Escalation panel — lists units that hit max retries, shows diff + failure log per escalated unit

- [x] Campaign Summary view
  - [x] Final tally — units passed / failed / escalated
  - [x] Link to opened PR *(wired to `POST /campaign/{id}/finalize`; not click-tested to avoid a real push against a repo we don't own)*
  - [x] Per-unit diff viewer (accepted and escalated units)

### 4.2 Backend

- [ ] Project scaffolding
  - [ ] Init FastAPI project
  - [ ] Configure native WebSocket server
  - [ ] Connect to PostgreSQL
  - [ ] Set up env config (.env + dotenv)
  - [ ] Write Dockerfile (install Tree-sitter, git, test runners for target repo's stack)
  - [ ] Write docker-compose.yml (frontend + backend + Postgres)

- [ ] Repo ingestion
  - [ ] `POST /repo` endpoint — clones target repo, stores Repo record
  - [ ] Trigger Discovery Engine parse + graph build on ingestion

- [ ] Discovery Engine
  - [ ] `GET /repo/{id}/candidates` endpoint — returns ranked seam candidates
  - [ ] Safety blacklist filter applied before candidates are returned (see 4.3)
  - [ ] `POST /repo/{id}/seam` endpoint — operator confirms or submits a manual seam definition

- [ ] Campaign management
  - [ ] `POST /campaign` endpoint — validates seam, splits into units, creates Campaign + Unit records, triggers Execution Engine
  - [ ] `GET /campaign/{id}` endpoint — returns current campaign status and all unit states
  - [ ] Campaign status updates streamed via WebSocket

- [ ] Verification Gate
  - [ ] Test runner wrapper — executes seam's `test_command` inside a unit's worktree, captures stdout/stderr
  - [ ] Retry loop — on failure, feed log back to Codex, re-invoke, increment attempt count, cap at 3
  - [ ] Escalation logic — after 3 failed attempts, mark unit `escalated`, store failure log

- [ ] PR assembly
  - [ ] `POST /campaign/{id}/finalize` endpoint — merges all accepted units, opens PR via GitHub API, lists escalated units in PR description

- [ ] Audit trail
  - [ ] Store `UnitEvent` on every status change (pending → running → passed/failed/retrying/escalated)

### 4.3 Discovery Engine (safety-critical — build last, gate carefully)

- [ ] Parsing & graph build
  - [ ] Tree-sitter parse of target repo — extract file/module structure and import relationships
  - [ ] Build dependency graph with NetworkX — nodes = files/modules, edges = imports/calls

- [ ] Ranking
  - [ ] Compute recent-commit-activity score per file (git log frequency, recency-weighted)
  - [ ] Compute centrality score per file (in-degree in the import/call graph — stand-in for full runtime centrality, which is out of scope for a one-day build)
  - [ ] Rank candidates by centrality × recent activity

- [ ] Safety blacklist
  - [ ] Default blacklist patterns: `auth/`, `payments/`, `**/migrations/` (DB schema migrations), any file matching common secrets/config patterns
  - [ ] Blacklist is configurable per repo, applied before candidates are ever shown to the operator or auto-selected in Autonomous mode
  - [ ] Autonomous mode refuses to proceed if the top-ranked candidate is blacklisted — falls back to next candidate, never silently overrides the blacklist

### 4.4 Execution Engine

- [ ] Unit splitting
  - [ ] Rule-based split of seam scope into units (one unit per file or per directory for hackathon scope — full dependency-aware splitting is a stretch goal, not required for demo)

- [ ] Worktree management
  - [ ] Create isolated git worktree per unit
  - [ ] Clean up worktrees after unit resolution (accepted or escalated)

- [ ] Codex invocation
  - [ ] Per-unit Codex call — scoped to unit's files, given before/after pattern + invariants
  - [ ] On retry — same call, with failure log appended as additional context

### 4.5 API Contracts

These are locked for the build. Any change requires flagging to the whole team before implementation, since frontend and backend are built in parallel against these shapes.

**POST /repo**

Request:
```
{
  "repoUrl": "string"
}
```

Response:
```
{
  "repoId": "string",
  "repoUrl": "string",
  "status": "cloning | ready | failed"
}
```

---

**GET /repo/{repoId}/candidates**

Response:
```
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

---

**POST /repo/{repoId}/seam**

Request:
```
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
Exactly one of `candidateId` or `manualSeam` must be provided. If both or neither are provided, reject with 400 (`error: "seam_input_invalid"`).

Response:
```
{
  "seamId": "string",
  "scopeGlobs": ["string"],
  "beforePattern": "string",
  "afterPattern": "string",
  "invariants": ["string"],
  "testCommand": "string"
}
```

---

**POST /campaign**

Request:
```
{
  "seamId": "string"
}
```

Response:
```
{
  "campaignId": "string",
  "status": "running",
  "unitCount": 0
}
```

---

**GET /campaign/{campaignId}**

Single source of truth for campaign state — used for initial load, page refresh/resume, and as the WebSocket fallback (polling).

Response:
```
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

---

**POST /campaign/{campaignId}/finalize**

Response:
```
{
  "campaignId": "string",
  "prUrl": "string",
  "acceptedUnits": 0,
  "escalatedUnits": 0
}
```

---

**WebSocket — /ws/campaign/{campaignId}**

Server → client events only.

```
{ "event": "campaign_started", "data": { "campaignId": "string" } }
{ "event": "unit_status", "data": { "unitId": "string", "status": "string", "attempt": 0 } }
{ "event": "unit_reasoning", "data": { "unitId": "string", "text": "string" } }
{ "event": "unit_escalated", "data": { "unitId": "string", "failureLog": "string" } }
{ "event": "campaign_completed", "data": { "campaignId": "string" } }
{ "event": "campaign_failed", "data": { "reason": "string" } }
```

---

**Data Models Referenced**

- **Repo**: `repoId`, `repoUrl`, `status`, `createdAt`
- **Seam**: `seamId`, `repoId`, `scopeGlobs`, `beforePattern`, `afterPattern`, `invariants`, `testCommand`
- **Campaign**: `campaignId`, `seamId`, `status`, `createdAt`
- **Unit**: `unitId`, `campaignId`, `scopeGlob`, `status` (enum), `attempt`, `diff`, `failureLog`, `createdAt`
- **UnitEvent**: `id`, `unitId`, `eventType`, `message`, `metadata`, `createdAt`

---

## 5. Database Schema (PostgreSQL)

```sql
CREATE TABLE repos (
  repo_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('cloning', 'ready', 'failed')) DEFAULT 'cloning',
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

Notes:
- `Campaign` summary stats (accepted/escalated counts) are computed at read time via `GROUP BY status` over `units`, not stored as columns.
- `attempt` on `units` caps at 3 by application logic, not a DB constraint — the constraint lives in the retry loop in the Execution Engine.

---

## 6. Demo Target

A real, pre-vetted open-source repository (5–10K lines) with a genuine, defined migration opportunity — e.g. Express → Fastify route conversion, or a deprecated API sweep.

- [ ] Repo selection
  - [ ] Choose and freeze the demo repo — no swapping after Day 0
  - [ ] Confirm the repo's test suite runs cleanly on a fresh clone, with no flaky tests
  - [ ] Confirm the chosen seam produces a clean, demonstrable before/after (not trivial, not unreasonably large)

- [ ] Seam pre-validation
  - [ ] Manually verify the seam's `test_command` correctly distinguishes before-state from after-state
  - [ ] Manually run the migration once end-to-end before demo day to confirm the loop actually converges (not just theoretically should)

- [ ] Full rehearsal — run before presentation, not during it
  - [ ] Run a complete campaign end-to-end against the demo repo before demo day — ingest → seam review → campaign → live dashboard → PR
  - [ ] Deliberately trigger at least one retry scenario before demo day — confirm the retry-with-evidence loop actually works, not just the happy path
  - [ ] Time the full demo flow once to make sure it fits the available slot
  - [ ] Record a backup video of a full successful run

---

## 7. Fallbacks

| Component | Fallback |
|---|---|
| Discovery Engine ranking fails or looks unsafe | Switch to Guided mode — operator manually defines the seam, campaign still runs and verifies normally |
| Codex API fails mid-unit | Retry loop treats it as a failed attempt — same 3-retry/escalate path handles it, no special-casing needed |
| WebSocket fails | Polling — frontend polls `GET /campaign/{id}` every 2 seconds |
| Parallel worktree execution fails | Fall back to sequential unit processing — slower, but the verification loop still holds end-to-end |
| Dependency graph rendering fails | Fall back to the plain unit status table — still shows real progress, just without the visual graph |
| PR creation via GitHub API fails | Present the aggregated diff directly in the Campaign Summary view, mention PR creation as a completed-but-not-demoed step |
