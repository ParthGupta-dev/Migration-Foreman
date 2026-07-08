# scripts/

Dev/ops utilities for Migration Foreman. Owner: Parth (see [../docs/PROJECT.md](../docs/PROJECT.md), section 9).

| Script | Purpose |
| --- | --- |
| `setup_demo_repo.py` | Generates the frozen demo repo at `backend/data/demo-repo`: a real `legacy_format -> format_text` migration seam with clean-swap units, one deliberate escalation (`src/exporter.py`), a blacklisted `payments/` path, seam config (`.migration-foreman.json`), and a clean unittest suite. Verifies the suite passes before finishing. |
| `run_campaign.py` | Stdlib-only CLI that drives the backend end-to-end without the frontend: ingest → candidates → seam → campaign → live poll → optional `--finalize`. |
| `seed_data.py` | Inserts sample Repo/Seam/Campaign/Unit/UnitEvent rows into Postgres so the frontend can be developed against realistic data (requires asyncpg; honors `DATABASE_URL`). |

Typical demo prep:

```bash
python scripts/setup_demo_repo.py            # build + freeze the demo repo
docker compose up -d                          # boot postgres + backend (+ frontend)
MOCK_CODEX=1 docker compose up -d backend     # offline mode, no OpenAI key needed
python scripts/run_campaign.py --repo-url /app/data/demo-repo
```
