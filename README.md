# Migration Foreman

Any engineer, any repository, productive in minutes.

Migration Foreman turns a plain-English migration goal — *"Upgrade requests to httpx"* — into a supervised, test-verified migration campaign. An AI planner converts the intent into a concrete migration spec and grounds it against the actual repository; execution then runs each file as an isolated unit in its own git worktree, verifies every change against the test suite, retries failures with the real failure log, escalates what it can't fix, and assembles the passing work into a pull request. The whole run streams live to the browser.

It is LLM-provider-agnostic: Codex (OpenAI), Groq, or any OpenAI-compatible endpoint — chosen entirely by the env file, no code changes.

Architecture, contracts, and conventions: [docs/PROJECT.md](docs/PROJECT.md).

## Team — Merge Conflicts

| Name | Role |
| Parth | Backend + Orchestration |
| Arushi | Frontend |
| Pratima | Design |
| Tanvi | Deck |

## How a migration flows

```
Repository URL
      │
      ▼
Repo ingestion + dependency graph & candidate discovery
      │
      ▼
AI Planning Stage ──── user intent: "Upgrade requests to httpx"
      │                LLM proposes: migration name, before/after patterns,
      │                scope, risk, breaking changes, confidence, reasoning
      ▼
Grounding & validation ── the plan is checked against the real clone:
      │                   occurrences counted per file, impossible scopes
      │                   repaired, unfounded plans rejected
      ▼
Plan review ── user sees the checklist (✓ occurrences ✓ scope ✓ confidence)
      │         and approves; a seam is created automatically
      ▼
Batch execution ── one unit per file, parallel isolated git worktrees
      │
      ▼
Verification gate ── the seam's test command runs for every migrated unit
      │
      ├── pass → unit merged into the campaign branch
      ├── fail → retried with the real failure log (up to 3 attempts)
      └── still failing → escalated to the human review queue
      ▼
PR assembly ── accepted units become one pull request;
               escalated units are listed for human follow-up
```

Planning is the default entry point, but not the only one: **Guided** mode lets you type the seam (patterns, scope, test command) by hand, and **Autonomous** mode picks from the ranked candidates that discovery generates from graph centrality × recent git activity. Repos can optionally carry a `.migration-foreman.json` to pre-configure their seam — it's an advanced override, never a prerequisite.

## Quickstart

```bash
cp .env.example .env                      # add keys as needed (see below)
python scripts/setup_demo_repo.py         # generate the frozen demo repo (backend/data/demo-repo)
MOCK_CODEX=1 docker compose up -d --build # postgres + backend + frontend, offline LLM mock
```

Then either open the UI at **http://localhost:3000**, or drive everything from the CLI:

```bash
python scripts/run_campaign.py --repo-url /app/data/demo-repo \
    --intent "Migrate legacy_format to format_text"
```

`MOCK_CODEX=1` runs the entire pipeline (planning, grounding, worktrees, test gate, retries, escalation, live WebSocket stream) with a deterministic offline stand-in for the LLM — no API key needed.

## End-to-end walkthrough

The demo repo is a small Python project where a deprecated `legacy_format` helper must be replaced by `format_text` across modules that use it in different ways — some trivially, some in ways that break tests and exercise the retry/escalation path.

**1. Ingest.** Open http://localhost:3000, click the demo repo preset (or paste any Git URL). The backend clones the repo, builds the import dependency graph, and ranks migration candidates.

**2. State the goal in plain English.** The default **AI Plan** mode shows an intent box. Type:

> Migrate legacy_format to format_text

and click **Generate plan**.

**3. The planner generates and grounds the plan.** The LLM proposes the migration spec; the backend then validates it against the actual clone before you ever see it — counting real occurrences, repairing scopes that miss the code, and rejecting plans whose pattern doesn't exist in the repo. The result card shows:

```
legacy_format -> format_text   [risk: medium] [breaking changes: yes]
✓ Found 20 occurrence(s) across 6 file(s)
✓ Confidence 0.60
Reason: …call sites still on the old name would break once it is removed.
        Pattern grounded in 6 file(s) with 20 occurrence(s).
```

plus the grounded file list and an editable test command (inferred from the repo layout when the plan doesn't supply one).

**4. Review and approve.** Check the patterns, files, and risk; adjust the test command if needed; click **✓ Ready for execution — use this plan**. A seam is created automatically from the approved plan — no manual seam configuration.

**5. Batch execution.** Confirm the seam and start the campaign. Each in-scope file becomes one unit; units run in parallel (bounded by `UNIT_PARALLELISM`), each in its own git worktree so attempts never contaminate each other. The campaign page streams unit status and the migration agent's per-file rationale live over WebSocket.

**6. Verification on every unit.** After each migrated file, the seam's test command runs in that unit's worktree. Passing units merge into the campaign branch.

**6b. Inspect any resolved unit.** Every passed or escalated unit gets two actions: **View Diff** (the raw patch) and **Live Preview** — a before/after view rendered by file type: Markdown files render as formatted documents (the demo repo's README is migrated and shows this), HTML renders in a sandboxed frame, CSS is applied to a sample page Storybook-style, and code shows side by side. The full `pytest`/`unittest` output for the unit is one click away in the same panel.

**7. Retry and escalation.** A failing unit is retried with the actual test failure log fed back to the LLM (up to `MAX_ATTEMPTS`, default 3). Units that still fail are **escalated** — parked with their diff and failure log for human review, without blocking the rest of the campaign. In the demo, the files needing more than a rename escalate by design.

**8. Pull request.** When the campaign completes, **Finalize** assembles all accepted units into a single PR on the campaign branch (requires a GitHub-hosted repo and `GITHUB_TOKEN`), with escalated units listed for follow-up. For non-GitHub repos, finalize returns `502 pr_creation_failed` and the summary view falls back to the aggregated diffs.

## LLM providers

Everything model-facing goes through one env-driven client (`backend/llm.py`). Set keys in `.env` and the planner, migrator, retries, and rationale streaming all follow automatically:

| Setup in `.env` | Provider used |
| --- | --- |
| `OPENAI_API_KEY=…` | Codex via the OpenAI Responses API (`CODEX_MODEL`, default `gpt-5-codex`) |
| `GROQ_API_KEY=…` | Groq chat completions (`GROQ_MODEL`, default `llama-3.3-70b-versatile`) |
| `LLM_PROVIDER=<name>` + `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | Any OpenAI-compatible endpoint (e.g. `LLM_PROVIDER=ollama`, `LLM_BASE_URL=http://localhost:11434/v1`) |
| `MOCK_CODEX=1` | Deterministic offline mock — full pipeline, zero keys |

With multiple keys set, `LLM_PROVIDER=codex|groq|<name>` picks explicitly; left empty, the first configured provider wins (codex → groq → custom). `GET /health` reports the active provider, e.g. `{"llm": "groq:llama-3.3-70b-versatile"}`.

## API surface

Backend at http://localhost:8000 (interactive docs at `/docs`):

| Endpoint | Purpose |
| --- | --- |
| `POST /repo` | Clone + analyze a repository |
| `GET /repo/{id}/candidates` | Ranked migration candidates |
| `GET /repo/{id}/graph` | Dependency graph for the frontend views |
| `POST /repo/{id}/plan` | **AI Planning Stage**: intent in, grounded migration spec out |
| `POST /repo/{id}/seam` | Create a seam (from a plan, a candidate, or manually) |
| `POST /campaign` | Start a migration campaign |
| `GET /campaign/{id}` | Campaign + unit status |
| `GET /campaign/{id}/unit/{id}/preview` | Before/after file contents + full test output for the Live Preview view |
| `POST /campaign/{id}/finalize` | Assemble the PR |
| `WS /ws/campaign/{id}` | Live unit status, reasoning, and escalation events |
| `GET /health` | Service, database, and active LLM provider status |
