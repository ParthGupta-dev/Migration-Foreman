"""Seed Postgres with sample Repo/Seam/Campaign/Unit/UnitEvent rows.

For frontend development against realistic data without running a campaign.
Requires asyncpg (run inside the backend container):
  docker compose exec backend python /app/../scripts/seed_data.py
or with scripts mounted:  python scripts/seed_data.py
Honors DATABASE_URL (defaults to the local compose Postgres).
"""

import asyncio
import json
import os

import asyncpg

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/migration_foreman"
)

UNITS = [
    ("src/reports.py", "passed", 1, "--- a/src/reports.py\n+++ b/src/reports.py\n-from lib.textkit import legacy_format\n+from lib.textkit import format_text\n", None),
    ("src/notifications.py", "passed", 2, "--- a/src/notifications.py\n+++ b/src/notifications.py\n-legacy_format(recipient)\n+format_text(recipient)\n", None),
    ("src/exporter.py", "escalated", 3, "--- a/src/exporter.py\n+++ b/src/exporter.py\n-note = legacy_format(row.get(\"note\"))\n+note = format_text(row.get(\"note\"))\n", "TypeError: format_text expects str, got NoneType\nFAILED (errors=1)"),
    ("src/__init__.py", "running", 1, None, None),
]


async def main() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        repo = await conn.fetchrow(
            "INSERT INTO repos (repo_url, status) VALUES ($1, 'ready') RETURNING repo_id",
            "/app/data/demo-repo",
        )
        seam = await conn.fetchrow(
            "INSERT INTO seams (repo_id, scope_globs, before_pattern, after_pattern, invariants, test_command) "
            "VALUES ($1, $2, $3, $4, $5, $6) RETURNING seam_id",
            repo["repo_id"], ["src/**/*.py"], "legacy_format", "format_text",
            ["All unit tests pass"], "python -m unittest discover -s tests -t . -v",
        )
        campaign = await conn.fetchrow(
            "INSERT INTO campaigns (seam_id, status) VALUES ($1, 'running') RETURNING campaign_id",
            seam["seam_id"],
        )
        for scope_glob, status, attempt, diff, failure_log in UNITS:
            unit = await conn.fetchrow(
                "INSERT INTO units (campaign_id, scope_glob, status, attempt, diff, failure_log) "
                "VALUES ($1, $2, $3, $4, $5, $6) RETURNING unit_id",
                campaign["campaign_id"], scope_glob, status, attempt, diff, failure_log,
            )
            await conn.execute(
                "INSERT INTO unit_events (unit_id, event_type, message, metadata) "
                "VALUES ($1, 'status_change', $2, $3::jsonb)",
                unit["unit_id"], f"Seeded unit in status {status}",
                json.dumps({"status": status, "attempt": attempt}),
            )
        print(f"Seeded: repo={repo['repo_id']} seam={seam['seam_id']} campaign={campaign['campaign_id']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
