# Migration Foreman

Any engineer, any repository, productive in minutes.

Migration Foreman is an autonomous code migration system built on Codex. It identifies the highest-value migration target in a legacy repository, executes the migration as a supervised, test-verified campaign using parallel Codex agents in isolated git worktrees, and visualizes the entire process live.

Source of truth for scope, architecture, contracts, conventions, and ownership: [docs/PROJECT.md](docs/PROJECT.md).

## Team — Merge Conflicts

| Name | Role |
| --- | --- |
| Parth | Backend + Orchestration |
| Arushi | Frontend |
| Sujat | PR Reviewer |
| Tanvi | Deck |

## Quickstart

```bash
cp .env.example .env                      # fill in GITHUB_TOKEN / OPENAI_API_KEY as needed
python scripts/setup_demo_repo.py         # generate the frozen demo repo (backend/data/demo-repo)
MOCK_CODEX=1 docker compose up -d --build # postgres + backend (+ frontend), offline Codex mock
python scripts/run_campaign.py --repo-url /app/data/demo-repo
```

`MOCK_CODEX=1` runs the entire pipeline (discovery ranking, worktrees, test
gate, retries, escalation, live WebSocket stream) without an OpenAI key by
substituting a deterministic pattern rewrite for the Codex call. Unset it and
provide `OPENAI_API_KEY` for real Codex migrations. PR assembly
(`POST /campaign/{id}/finalize`) needs a GitHub-hosted repo plus
`GITHUB_TOKEN`; on anything else it returns `502 pr_creation_failed` and the
summary view falls back to showing the aggregated diffs.

Backend API: http://localhost:8000 (interactive docs at `/docs`). Frontend dev server: http://localhost:3000.
