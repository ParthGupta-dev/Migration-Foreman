# Migration Foreman — Build Plan
**Team: Merge Conflicts | Codex Community Hackathon, NCR**

---

## 1. Project Overview

Migration Foreman is an AI migration **architect** built on Codex. From a high-level engineering objective ("Modernize authentication") it analyzes the repository read-only, discovers candidate migration seams with risk/confidence/reasoning attached, and presents them for **mandatory human approval** — nothing executes without explicit confirmation. Approved seams run as supervised, test-verified campaigns using parallel Codex agents in isolated git worktrees, with the entire process visualized live — dependency graph, unit status, retries — instead of leaving engineers to review a wall of unreadable diffs.

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

**Component Flow:** Repo → Repository Analysis → AI Seam Discovery → Human Approval → Seam Creation → Execution Engine → Verification Gate → Dashboard → Verified Pull Request

**Step by step:**

1. Operator submits a repo URL (or a repo is pre-pulled for the demo) via frontend
2. Backend clones the repo, Discovery Engine parses it (Tree-sitter) and builds a dependency graph (NetworkX)
3. Operator states a high-level engineering objective in plain English — no repo knowledge or manual seam identification required
4. **Repository analysis (read-only)** — file census, language breakdown, dependency-graph stats, most-depended-on files; no code is modified
5. **AI seam discovery** — the planning model decomposes the objective into candidate seams `{title, description, before_pattern, after_pattern, scope_globs, risk, confidence, breaking_changes, depends_on, reasoning}`; each is grounded against the actual clone (occurrences counted per file, impossible scopes repaired, unfounded seams dropped)
6. **Human approval (mandatory)** — seams are shown as expandable cards; the operator approves all, approves selected, rejects, or edits individual seams. Execution never begins without explicit confirmation
7. Each approved seam becomes a regular Seam record via the existing `POST /repo/{id}/seam` — the execution pipeline downstream is unchanged
8. `POST /campaign` creates a Campaign record, backend splits the seam into independent **units** (rule-based split: one unit per file/module for hackathon scope); multiple approved seams execute one campaign at a time in dependency-respecting order
9. For each unit: backend creates an isolated git worktree, invokes Codex with the before/after pattern scoped to that unit's files, applies the returned diff
10. Verification Gate runs the seam's `test_command` inside the unit's worktree
11. Pass → unit marked `accepted`, merged back. Fail → full failure log fed back to Codex for a retry (max 3 attempts), then `escalated` to human review queue if still failing
12. Every state change streams to frontend via WebSocket — dashboard updates live (table + dependency graph, color-coded by unit status)
13. On campaign completion → publishing is a separate, optional concern with a user choice: **Apply locally** (default — the verified campaign branch is merged into the repo's default branch, no GitHub auth required; the UI shows changed files, diff summary, and copyable git commands) or **Create pull request** (connect GitHub via a session token or server `GITHUB_TOKEN`; backend pushes the campaign branch and opens a single PR aggregating all accepted units, escalated units listed separately for manual follow-up)

**Modes:**
- **AI Discovery (default)** — operator states a high-level objective; the AI discovers candidate seams and the operator approves/edits/rejects them before anything runs
- **Guided** — operator manually defines the seam (skip Discovery Engine scoring, use for demo safety if ranking isn't stable)
- **Autonomous** — the exact same AI discovery pipeline as AI Discovery (single planning implementation), presented with minimal interaction: one confirm-and-execute click covers all discovered seams instead of per-seam approve/edit/reject. Both AI modes require explicit human confirmation before execution; neither requires manual before/after patterns or `.migration-foreman.json`

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
  - [x] Mode selector — AI Discovery (default) / Guided / Autonomous
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

- [x] Project scaffolding
  - [x] Init FastAPI project
  - [x] Configure native WebSocket server
  - [x] Connect to PostgreSQL
  - [x] Set up env config (.env + dotenv)
  - [x] Write Dockerfile (install Tree-sitter, git, test runners for target repo's stack)
  - [x] Write docker-compose.yml (frontend + backend + Postgres)

- [x] Repo ingestion
  - [x] `POST /repo` endpoint — clones target repo, stores Repo record
  - [x] Trigger Discovery Engine parse + graph build on ingestion

- [x] Discovery Engine
  - [x] `GET /repo/{id}/candidates` endpoint — returns ranked seam candidates
  - [x] Safety blacklist filter applied before candidates are returned (see 4.3)
  - [x] `POST /repo/{id}/seam` endpoint — operator confirms or submits a manual seam definition

- [x] Campaign management
  - [x] `POST /campaign` endpoint — validates seam, splits into units, creates Campaign + Unit records, triggers Execution Engine
  - [x] `GET /campaign/{id}` endpoint — returns current campaign status and all unit states
  - [x] Campaign status updates streamed via WebSocket

- [x] Verification Gate
  - [x] Test runner wrapper — executes seam's `test_command` inside a unit's worktree, captures stdout/stderr
  - [x] Retry loop — on failure, feed log back to Codex, re-invoke, increment attempt count, cap at 3
  - [x] Escalation logic — after 3 failed attempts, mark unit `escalated`, store failure log

- [x] PR assembly
  - [x] `POST /campaign/{id}/finalize` endpoint — merges all accepted units, opens PR via GitHub API, lists escalated units in PR description

- [x] Audit trail
  - [x] Store `UnitEvent` on every status change (pending → running → passed/failed/retrying/escalated)

### 4.3 Discovery Engine (safety-critical — build last, gate carefully)

- [x] Parsing & graph build
  - [x] Tree-sitter parse of target repo — extract file/module structure and import relationships
  - [x] Build dependency graph with NetworkX — nodes = files/modules, edges = imports/calls

- [x] Ranking
  - [x] Compute recent-commit-activity score per file (git log frequency, recency-weighted)
  - [x] Compute centrality score per file (in-degree in the import/call graph — stand-in for full runtime centrality, which is out of scope for a one-day build)
  - [x] Rank candidates by centrality × recent activity

- [x] Safety blacklist
  - [x] Default blacklist patterns: `auth/`, `payments/`, `**/migrations/` (DB schema migrations), any file matching common secrets/config patterns
  - [x] Blacklist is configurable per repo, applied before candidates are ever shown to the operator or auto-selected in Autonomous mode
  - [x] Autonomous mode refuses to proceed if the top-ranked candidate is blacklisted — falls back to next candidate, never silently overrides the blacklist

### 4.4 Execution Engine

- [x] Unit splitting
  - [x] Rule-based split of seam scope into units (one unit per file or per directory for hackathon scope — full dependency-aware splitting is a stretch goal, not required for demo)

- [x] Worktree management
  - [x] Create isolated git worktree per unit
  - [x] Clean up worktrees after unit resolution (accepted or escalated)

- [x] Codex invocation
  - [x] Per-unit Codex call — scoped to unit's files, given before/after pattern + invariants
  - [x] On retry — same call, with failure log appended as additional context

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

**POST /repo/{repoId}/discover** *(current-version addition — AI Seam Discovery)*

Request:
```
{
  "objective": "string"   // high-level engineering objective, plain English
}
```

Response (advisory and stateless — nothing is created or executed):
```
{
  "repoId": "string",
  "objective": "string",
  "repoSummary": {
    "fileCount": 0, "sourceFileCount": 0,
    "languages": { "py": 0 }, "topDirectories": ["string"],
    "graphNodes": 0, "graphEdges": 0, "mostDependedOnFiles": ["string"]
  },
  "seams": [
    {
      "seamId": "seam-0",          // discovery-local id, not a DB row
      "title": "string", "description": "string",
      "executionOrder": 0, "dependsOn": ["seam-1"],
      "beforePattern": "string", "afterPattern": "string",
      "scopeGlobs": ["string"], "invariants": ["string"],
      "testCommand": "string | null",
      "risk": "low | medium | high", "breakingChanges": false,
      "confidence": 0.0, "reasoning": "string",
      "groundedFiles": ["string"], "estimatedFiles": 0,
      "occurrences": 0, "repairedScope": false
    }
  ],
  "droppedSeams": [{ "title": "string", "reason": "string" }],
  "seamCount": 0, "totalEstimatedFiles": 0,
  "overallRisk": "low | medium | high", "estimatedMinutes": 0
}
```
Approved seams are then submitted individually as `manualSeam` via `POST /repo/{repoId}/seam` — the human approval step is the only bridge between discovery and execution.

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

### 4.6 AI Seam Discovery & Human Approval (added post-hackathon plan — current version)

Evolves the planning layer from "one intent, one seam" to "one objective, many approved seams". Execution engine untouched: discovery is a producer of regular Seam records.

- [x] Repository analysis (read-only)
  - [x] File census, language breakdown, top directories
  - [x] Dependency-graph stats (nodes/edges) + most-depended-on files
- [x] AI seam discovery (`backend/planning/seam_discovery.py`)
  - [x] `POST /repo/{id}/discover` — objective in, repo analysis + grounded candidate seams out (stateless, advisory)
  - [x] Multi-seam LLM decomposition with title, description, patterns, scope, risk, confidence, breaking changes, dependsOn, reasoning
  - [x] Per-seam grounding against the clone (reuses planner validation): occurrence census, scope repair, unfounded seams dropped with reasons
  - [x] Dependency-respecting execution ordering (topological, cycle-safe)
  - [x] Campaign-level rollups: seam count, total files, overall risk, estimated minutes
  - [x] `MOCK_CODEX=1` offline path (single-seam mock decomposition)
- [x] Human approval UI (`frontend/components/SeamDiscoveryPanel.tsx`)
  - [x] AI Discovery replaces the manual entry point as the default mode
  - [x] Discovery summary header — objective, repo summary, seam count, files affected, overall risk, estimated time
  - [x] Expandable seam cards — risk, confidence, file/occurrence counts, breaking changes, reasoning, before → after, grounded files, dependencies
  - [x] Per-card ✓ Approve / ✏ Edit (title, patterns, scope, test command) / ✕ Reject
  - [x] Bottom bar — Approve Selected Seams / Approve All / Cancel Migration
  - [x] Execution never begins without explicit confirmation (approval creates the seams and starts the first campaign)
- [x] Multi-seam execution
  - [x] Approved seams convert to regular Seam records via existing `POST /repo/{id}/seam`
  - [x] Campaigns run one at a time in approved order; remaining seams queue client-side and the campaign summary offers "Start next seam campaign"
- [x] Single planning implementation (consolidation)
  - [x] Legacy single-seam `POST /repo/{id}/plan` removed; `planner.py` reduced to the shared grounding/validation library used by discovery
  - [x] Autonomous mode (UI) runs discovery and pauses for one confirm-and-execute click — never requires manual patterns or `.migration-foreman.json`
  - [x] CLI runner (`scripts/run_campaign.py`) uses the same `/discover` pipeline with a confirmation prompt (`--yes` for unattended); legacy candidate/pattern path removed

### 4.7 Publishing Choice: Apply Locally vs Pull Request (current version)

Separates migration execution from repository publishing. GitHub authentication is no longer a mandatory requirement; the entire workflow completes without it.

- [x] Backend split (`pr/local_apply.py` + reworked `pr/assembler.py`)
  - [x] `POST /campaign/{id}/apply` — default path: merge the verified campaign branch into the repo's default branch (idempotent); returns local path, changed files, diff summary, and suggested git commands
  - [x] `POST /campaign/{id}/finalize` — optional path: accepts a per-request `githubToken` (connect-GitHub UI flow) with `GITHUB_TOKEN` env as fallback
  - [x] `GET /github/status` — whether server-side GitHub credentials exist
  - [x] Migration/verification/retry/planning stages unchanged
- [x] Completion screen (`frontend/components/CompletionPanel.tsx`)
  - [x] Migration-complete header: verification result, changed files, passed/escalated counts
  - [x] Apply Locally card (default): one-click apply, then modified files, diff summary, local repo path, Copy Git Commands
  - [x] Create Pull Request card: Connect GitHub (session-only token via UI — OAuth is the intended long-term flow) or one-click PR when already connected
  - [x] PR failure falls back to local apply / aggregated diffs

### 4.8 Automatic Verification Command Discovery (current version)

Precondition confirmed first: fresh clone → worktree → inferred command runs (no dependency-install step exists; commands rely on the backend environment, so inference prefers infra-free invocations).

- [x] Detection (`repo_config.py`), in priority order
  - [x] Repository-specific scripts: `package.json` scripts, `Makefile` test target
  - [x] Framework/lockfile conventions: pytest signals (pyproject/poetry.lock/requirements/tox.ini + test presence), npm/pnpm/yarn by lockfile, Cargo, go.mod, Maven, Gradle (gradlew-aware), .NET
  - [x] Safe stdlib fallback: `python -m unittest discover` when `tests/test*.py` exists
  - [x] CI YAML parsing explicitly out of scope — CI-only signal counts as "no confident match"
- [x] Disambiguation: npm script preference `test` → `test:unit` → `test:ci` → first `test:unit:*`; `watch`/`e2e`/`dev` never auto-selected; ambiguous leftovers = no confident match; pytest beats tox
- [x] Monorepo: per-top-level-directory detection; a seam confined to one manifest-bearing dir gets a `cd "<dir>" && <cmd>`-scoped command; spanning seams with no root manifest and no single resolvable dir = no confident match
- [x] Safe fallback rule: `testCommand: null` is legal; AI Discovery/Guided require the human to fill it before submission (existing); Autonomous excludes such seams from the confirm batch until edited
- [x] Visibility: verification command shown on every seam card in every mode (pre-filled, editable — ✏ Edit available in Autonomous too); live campaign view displays the running command (`GET /campaign/{id}` now carries `testCommand`)
- [x] Execution unchanged: only the source of the command differs

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
