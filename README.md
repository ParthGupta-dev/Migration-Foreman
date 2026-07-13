# Migration Foreman

Any engineer, any repository, productive in minutes.

Migration Foreman turns a high-level engineering objective — *"Modernize authentication"*, *"Upgrade requests to httpx"* — into a supervised, test-verified migration campaign. It is an AI migration **architect**, not just an executor: it analyzes the repository read-only, discovers candidate migration seams with risk, confidence, and reasoning attached, and presents them for **explicit human approval — nothing executes until an engineer approves the plan**. Approved seams then run through the execution engine: each file becomes an isolated unit in its own git worktree, every change is verified against the test suite, failures are retried with the real failure log, what can't be fixed is escalated, and the passing work is assembled into a pull request. The whole run streams live to the browser.

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
Repo ingestion ── clone + import dependency graph + candidate ranking
      │
      ▼
Engineering objective ── "Modernize authentication" (plain English;
      │                   no repo knowledge or seam-writing required)
      ▼
Repository analysis ── read-only: file census, language breakdown,
      │                 dependency-graph stats, most-depended-on files
      ▼
AI seam discovery ── the model decomposes the objective into candidate
      │               seams, each with title, description, before/after
      │               patterns, scope, risk, confidence, breaking changes,
      │               dependencies, and reasoning
      ▼
Grounding & validation ── every seam is checked against the real clone:
      │                    occurrences counted per file, impossible scopes
      │                    repaired, unfounded seams dropped
      ▼
HUMAN APPROVAL ── the mandatory safety checkpoint: approve all, approve
      │            selected, reject, or edit individual seams; change
      │            nothing runs without explicit confirmation
      ▼
Seam creation ── each approved seam becomes a regular Seam record and
      │           flows through the existing pipeline unchanged
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
Completion ── publishing is a separate, optional concern:
      ├── Apply locally (default) ── verified changes merged into the
      │                              repo's default branch; no GitHub
      │                              authentication required
      └── Create pull request ────── connect GitHub and the campaign
                                     branch becomes one PR, escalated
                                     units listed for follow-up
```

**AI Discovery** is the default entry point, but not the only one: **Guided** mode lets you type the seam (patterns, scope, test command) by hand, and **Autonomous** mode runs the *exact same* discovery pipeline with minimal interaction — the discovered seams are presented once and a single **Confirm & execute** click runs them all, versus AI Discovery's full per-seam approve/edit/reject. Both AI modes share one planning implementation and both require explicit human confirmation before execution; neither ever needs manual before/after patterns or a `.migration-foreman.json` (repos can still carry one as an advanced override for Guided mode, never a prerequisite).

When several seams are approved at once, they execute one campaign at a time in dependency-respecting order: the first campaign starts immediately, and each campaign-summary page offers **Start next seam campaign** until the approved queue is drained.

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

The CLI uses the same discovery pipeline as the UI: it prints the discovered seams and asks for confirmation before executing (pass `--yes` for unattended runs).

`MOCK_CODEX=1` runs the entire pipeline (planning, grounding, worktrees, test gate, retries, escalation, live WebSocket stream) with a deterministic offline stand-in for the LLM — no API key needed.

## End-to-end walkthrough

The demo repo is a small Python project where a deprecated `legacy_format` helper must be replaced by `format_text` across modules that use it in different ways — some trivially, some in ways that break tests and exercise the retry/escalation path.

**1. Ingest.** Open http://localhost:3000, click the demo repo preset (or paste any Git URL). The backend clones the repo, builds the import dependency graph, and ranks migration candidates.

**2. State the objective in plain English.** The default **AI Discovery** mode shows an objective box. Type:

> Migrate legacy_format to format_text

and click **Discover seams**. Nothing about the repository's structure needs to be known — discovery is the system's job.

**3. The AI analyzes the repo and discovers seams.** The backend first performs a read-only repository analysis (file census, language breakdown, dependency-graph stats, most-depended-on files), then the model decomposes the objective into candidate seams. Every seam is grounded against the actual clone before you see it — real occurrences counted per file, impossible scopes repaired, seams whose pattern doesn't exist in the repo dropped. The discovery screen shows the overall picture (seam count, total files affected, overall risk, estimated execution time) and one expandable card per seam:

```
#1  legacy_format -> format_text   [medium] [7 file(s)] [confidence 0.60]
    Transformation: legacy_format → format_text
    Occurrences: 24 across 7 file(s) · Breaking changes: yes
    Reasoning: …call sites still on the old name would break once it is
               removed. Pattern grounded in 7 file(s) with 24 occurrence(s).
    Verification: python -m pytest -q
    + grounded file list, dependencies on other seams
```

The **verification command** is always visible on every card, in every mode — pre-filled, never hidden. When the model doesn't supply one it is inferred from the repository itself: `package.json` scripts (preferring `test` → `test:unit` → `test:ci`; `watch`/`e2e`/`dev` scripts are never auto-selected), `Makefile` test targets, pytest/unittest signals, or Cargo/Go/Maven/Gradle/.NET manifests — scoped per top-level directory in monorepos. No confident match is a legal outcome: the field says so and stays editable, and Autonomous mode excludes such seams from execution until a human fills the command in. Nothing ever runs unverified.

**4. Human approval — the mandatory checkpoint.** Each card has **✓ Approve**, **✏ Edit** (title, patterns, scope, test command), and **✕ Reject**. The bottom bar offers **Approve selected & execute**, **Approve all**, and **Cancel migration**. Seams are only created — and the first campaign only starts — when you approve; with several approved seams, the rest queue up and each campaign summary offers **Start next seam campaign**.

**5. Batch execution.** Each in-scope file becomes one unit; units run in parallel (bounded by `UNIT_PARALLELISM`), each in its own git worktree so attempts never contaminate each other. The campaign page streams unit status and the migration agent's per-file rationale live over WebSocket.

**6. Verification on every unit.** After each migrated file, the seam's test command runs in that unit's worktree. Passing units merge into the campaign branch.

**6b. Inspect any resolved unit.** Every passed or escalated unit gets two actions: **View Diff** (the raw patch) and **Live Preview** — a before/after view rendered by file type: Markdown files render as formatted documents (the demo repo's README is migrated and shows this), HTML renders in a sandboxed frame, CSS is applied to a sample page Storybook-style, and code shows side by side. The full `pytest`/`unittest` output for the unit is one click away in the same panel.

**7. Retry and escalation.** A failing unit is retried with the actual test failure log fed back to the LLM (up to `MAX_ATTEMPTS`, default 3). Units that still fail are **escalated** — parked with their diff and failure log for human review, without blocking the rest of the campaign. In the demo, the files needing more than a rename escalate by design.

**8. Publish — your choice.** When the campaign completes, the summary page shows a **Migration complete** screen (verification result, changed files, passed/escalated counts) with two publishing options:

- **Apply locally (default, no GitHub needed).** One click merges the verified campaign branch into the repo's default branch in the clone, then shows the modified files, a diff summary, the local repository path, and copyable git commands (`git status` / `git log` / `git push`) to take it from there.
- **Create pull request (optional).** Click **Connect GitHub** to authorize on github.com (OAuth web flow — the access token stays server-side, keyed to your browser session, and is never sent to the frontend; reconnect after a backend restart). Requires a registered GitHub OAuth App: set `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`, and make sure the app's Authorization callback URL exactly matches `GITHUB_OAUTH_REDIRECT_URI`. Without one, the button falls back to pasting a personal access token (browser session only, sent per request); `GITHUB_TOKEN` can also be preconfigured server-side. Then one click pushes the campaign branch and opens a PR with escalated units listed for follow-up. For non-GitHub repos this returns `502 pr_creation_failed` and the summary view falls back to the aggregated diffs.

The whole migration workflow completes without any GitHub authentication; publishing to GitHub is strictly optional post-processing.

## LLM providers

Everything model-facing goes through one env-driven client (`backend/llm.py`). Set keys in `.env` and the planner, migrator, retries, and rationale streaming all follow automatically:

| Setup in `.env` | Provider used |
| --- | --- |
| `OPENAI_API_KEY=…` | Codex via the OpenAI Responses API (`CODEX_MODEL`, default `gpt-5-codex`) |
| `GROQ_API_KEY=…` | Groq chat completions (`GROQ_MODEL`, default `openai/gpt-oss-20b`) |
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
| `POST /repo/{id}/discover` | **AI Seam Discovery** — the one planning pipeline (AI Discovery + Autonomous + CLI): objective in, repo analysis + grounded candidate seams out (read-only, advisory — confirmation happens before anything is created) |
| `POST /repo/{id}/seam` | Create a seam (from a confirmed discovered seam, a candidate, or manually) |
| `POST /campaign` | Start a migration campaign |
| `GET /campaign/{id}` | Campaign + unit status |
| `GET /campaign/{id}/unit/{id}/preview` | Before/after file contents + full test output for the Live Preview view |
| `POST /campaign/{id}/apply` | **Default publishing path**: merge the verified campaign branch into the local repo's default branch — no GitHub auth |
| `POST /campaign/{id}/finalize` | Optional publishing path: push + open a GitHub PR (token from the UI or `GITHUB_TOKEN`) |
| `GET /github/status` | Whether this session/backend can create PRs (`connected`, OAuth `username`, `oauthAvailable`) |
| `GET /github/oauth/start` | Begin the "Connect GitHub" OAuth web flow (302 to GitHub's authorize screen) |
| `GET /github/callback` | OAuth redirect target: validates state, exchanges the code, stores the token server-side |
| `WS /ws/campaign/{id}` | Live unit status, reasoning, and escalation events |
| `GET /health` | Service, database, and active LLM provider status |
