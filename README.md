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
python scripts/setup_demo_repo.py         # generate the frozen demo repo (server/data/demo-repo)
MOCK_CODEX=1 docker compose up -d --build # postgres + server + client, offline LLM mock
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

**1. Ingest.** Open http://localhost:3000, click the demo repo preset, paste any Git URL, or click **Connect GitHub** and pick one of your own repositories from the dropdown (private repos included — the connected session's token is used to clone). The backend clones the repo, builds the import dependency graph, ranks migration candidates, and bootstraps a **repository profile** — languages, frameworks, package manager, build system, test framework, source roots, entry points, CI/Docker config — inferred entirely from what's on disk (`server/discovery/profiler.py`). No `.migration-foreman` file of any kind is required for any of this: a first-time repository with zero prior Migration Foreman state works identically to one with campaign history. Only after a campaign completes does the backend optionally cache that profile plus a campaign-history entry into `.migration-foreman/` inside the clone — purely a speed/history cache; delete it and the next run just re-infers everything. See `GET /repo/{id}/profile`.

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

**6. Verification on every unit.** Before the seam's test command runs, the worktree's dependencies are installed first if the repo needs them — `package.json` → `npm`/`pnpm`/`yarn install` (whichever lockfile is present), `requirements.txt` → `pip install -r`, `pyproject.toml` → `pip install .`; a stdlib-only repo (like the demo) skips this entirely. A failed install is reported distinctly (`Dependency install failed`, not `Tests failed`) so a missing-module problem never looks like a broken migration. Then the test command runs in that unit's worktree; passing units merge into the campaign branch.

**6b. Inspect any resolved unit.** Every passed or escalated unit gets two actions: **View Diff** (the raw patch) and **Live Preview** — a before/after view rendered by file type: Markdown files render as formatted documents (the demo repo's README is migrated and shows this), HTML renders in a sandboxed frame, CSS is applied to a sample page Storybook-style, and code shows side by side. The full `pytest`/`unittest` output for the unit is one click away in the same panel.

**7. Retry and escalation.** A failing unit is retried with the actual test failure log fed back to the LLM (up to `MAX_ATTEMPTS`, default 3). Units that still fail are **escalated** — parked with their diff and failure log for human review, without blocking the rest of the campaign. In the demo, the files needing more than a rename escalate by design.

**8. Publish — your choice.** When the campaign completes, the summary page shows a **Migration complete** screen (verification result, changed files, passed/escalated counts) with two publishing options:

- **Apply locally (default, no GitHub needed).** One click merges the verified campaign branch into the repo's default branch in the clone, then shows the modified files, a diff summary, the local repository path, and copyable git commands (`git status` / `git log` / `git push`) to take it from there.
- **Create pull request (optional).** Click **Connect GitHub** to authorize on github.com (OAuth web flow — the access token is encrypted and stored server-side, keyed to your browser session via Postgres, and is never sent to the frontend). Without a registered OAuth App, the button falls back to pasting a personal access token (browser session only, sent per request); `GITHUB_TOKEN` can also be preconfigured server-side. Once connected, one click pushes the campaign branch and opens a PR with escalated units listed for follow-up — same connected session used to pick the repo in step 1 works here automatically. For non-GitHub repos this returns `502 pr_creation_failed` and the summary view falls back to the aggregated diffs.

The whole migration workflow completes without any GitHub authentication; publishing to GitHub is strictly optional post-processing.

### GitHub OAuth setup (for "Connect GitHub" + the repo picker)

1. On github.com: **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: `http://localhost:3000`. **Authorization callback URL: `http://localhost:8000/github/callback`** — must match `GITHUB_OAUTH_REDIRECT_URI` exactly (protocol, host, port, path), or the callback will reject the exchange.
3. Register the app, generate a client secret, then set in `.env`:
   ```
   GITHUB_OAUTH_CLIENT_ID=…
   GITHUB_OAUTH_CLIENT_SECRET=…
   SESSION_ENCRYPTION_KEY=…   # any long random string; encrypts tokens at rest
   ```
4. `docker compose up -d server` to pick up the new env vars.

Without this, `GET /github/status` reports `oauthAvailable: false` and the UI shows the manual-token fallback instead of the Connect button. A separately configured `GITHUB_TOKEN` env var makes `/github/status` report `connected: true` for the PR-creation fallback path, but it is **not** an OAuth session (`oauthConnected` stays `false`) and cannot be used to browse or pick "your" repositories — that requires an actual Connect GitHub login.

### GitHub API reference

All GitHub-facing endpoints live behind `SESSION_COOKIE` = `mf_session` (an `HttpOnly`, `SameSite=Lax` cookie the backend sets — the frontend never reads or sends the token itself, just `credentials: "include"`). None of them require a request body token unless noted; the manual-token fallback is only ever a per-request override on `POST /campaign/{id}/finalize`.

**Auth / session**

| Endpoint | Notes |
| --- | --- |
| `GET /auth/github/login?next=/` (alias `GET /github/oauth/start`) | 302 → `github.com/login/oauth/authorize` with a session-bound CSRF `state` and `scope=repo read:user`. `next` (default `/`) is the frontend path to return to; non-`/`-prefixed values are rejected back to `/`. Mints and sets the `mf_session` cookie if none exists yet. **400** `github_oauth_not_configured` if `GITHUB_OAUTH_CLIENT_ID`/`SECRET` aren't set. |
| `GET /auth/github/callback` (alias `GET /github/callback`) | GitHub's redirect target (`code`, `state`, or `error` query params). Validates `state` (one-shot, 10-minute TTL, session-bound), exchanges `code` for a token, fetches the GitHub profile, stores the (encrypted) session in Postgres, then 302s to `{FRONTEND_BASE_URL}{next}?github=connected\|cancelled\|error` — never a raw error page or an uncaught exception. |
| `GET /auth/session` | `{authenticated, username, avatar, githubId, repositoriesAvailable}`. `authenticated: false` (all other fields `null`/`false`) when there's no session or it expired — never an error. Touches the session's sliding-window expiry on success. |
| `POST /auth/logout` | Destroys the session server-side (Postgres row deleted). Returns `{"loggedOut": true}` unconditionally, even with no cookie present. |
| `GET /github/status` | `{connected, oauthConnected, username, oauthAvailable, avatar, repositoryCount, expiresAt}`. `connected` is true for session **or** env `GITHUB_TOKEN`; `oauthConnected` is true only for a real session — that's the flag the repo/branch picker gates on, not `connected`. `repositoryCount` is best-effort (`null` if the live GitHub call fails, e.g. rate limit). |

**Repositories**

| Endpoint | Notes |
| --- | --- |
| `GET /github/repositories` | `{repositories: [{owner, name, fullName, defaultBranch, private, permissions}]}` — every repo the session's token can see (owner + collaborator), paginated server-side. **401** `github_not_authenticated` if there's no usable token (no session and no `GITHUB_TOKEN`). |
| `GET /github/repository/{owner}/{repo}` | Single-repository metadata, same shape as one entry above. **401** `github_not_authenticated` under the same condition. |
| `GET /github/repository/{owner}/{repo}/branches` | `{branches: [{name, protected}]}`. Same auth requirement as above. |

**Pull requests / repo creation**

| Endpoint | Notes |
| --- | --- |
| `POST /repo` | `{repoUrl, branch?}`. `branch` is optional — omit it to clone the repo's default branch, or name one to `git clone -b <branch>` instead (used by the branch picker). If `repoUrl` is a `github.com` URL and this session/env has a token, the clone is authenticated automatically (needed for private repos) — the token is never persisted or logged, only the original `repoUrl` is. |
| `POST /campaign/{id}/finalize` | `{githubToken?}`. Token precedence: request body (manual paste) → OAuth session → `GITHUB_TOKEN` env. **502** `pr_creation_failed` on any push/API failure (non-GitHub `repoUrl`, no token at all, GitHub API error) — the frontend falls back to the aggregated diffs. |
| `POST /github/pull-request` | `{campaignId, title?, body?}` → `{campaignId, prUrl, acceptedUnits, escalatedUnits}`. The session-auth equivalent of `finalize` with custom title/body and no token in the request at all; requires the campaign to be `completed`. Same **502** `pr_creation_failed` failure mode. |

Everything above is implemented as thin route handlers over `services/github_service.py`, which is the only place that resolves *which* token to use (session → request body → `GITHUB_TOKEN` env) and the only caller of `github/client.py`'s GitHub REST wrapper — no other module talks to the GitHub API directly.

## LLM providers

Everything model-facing goes through one env-driven client (`server/llm.py`). Set keys in `.env` and the planner, migrator, retries, and rationale streaming all follow automatically:

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
| `GET /repo/{id}/profile` | Zero-config repository profile (languages, frameworks, package manager, build system, test framework, structure, entry points, CI/Docker config) — inferred fresh or loaded from an optional `.migration-foreman/` cache |
| `POST /repo/{id}/discover` | **AI Seam Discovery** — the one planning pipeline (AI Discovery + Autonomous + CLI): objective in, repo analysis + grounded candidate seams out (read-only, advisory — confirmation happens before anything is created) |
| `POST /repo/{id}/seam` | Create a seam (from a confirmed discovered seam, a candidate, or manually) |
| `POST /campaign` | Start a migration campaign |
| `GET /campaign/{id}` | Campaign + unit status |
| `GET /campaign/{id}/unit/{id}/preview` | Before/after file contents + full test output for the Live Preview view |
| `POST /campaign/{id}/apply` | **Default publishing path**: merge the verified campaign branch into the local repo's default branch — no GitHub auth |
| `POST /campaign/{id}/finalize` | Optional publishing path: push + open a GitHub PR (token from the UI or `GITHUB_TOKEN`) |
| `GET /github/status` | `connected` (session OR env `GITHUB_TOKEN`), `oauthConnected` (real session only — gates the repo picker), `username`, `oauthAvailable`, `repositoryCount` |
| `GET /auth/github/login` (alias `GET /github/oauth/start`) | Begin the "Connect GitHub" OAuth web flow (302 to GitHub's authorize screen) |
| `GET /auth/github/callback` (alias `GET /github/callback`) | OAuth redirect target: validates state, exchanges the code, stores the (encrypted) token server-side |
| `GET /auth/session` | Session validation for a frontend: `{authenticated, username, avatar, githubId, repositoriesAvailable}` |
| `POST /auth/logout` | Destroy the current GitHub session |
| `GET /github/repositories` | Repositories available to the authenticated session (owner, name, defaultBranch, private, permissions) |
| `GET /github/repository/{owner}/{repo}` | Metadata for one repository |
| `GET /github/repository/{owner}/{repo}/branches` | Branches for one repository (name, protected) — powers the repo-input page's branch picker |
| `POST /github/pull-request` | Push + open a PR for a completed campaign using the authenticated session — no token in the request |
| `WS /ws/campaign/{id}` | Live unit status, reasoning, and escalation events |
| `GET /health` | Service, database, and active LLM provider status |

GitHub authentication is its own backend layer — see `auth/` (OAuth + encrypted sessions), `github/` (REST client, repositories, PRs), and `services/github_service.py` (the facade the migration engine and API routes call; nothing else touches the GitHub API or session internals directly).
