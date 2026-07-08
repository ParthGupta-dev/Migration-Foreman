"""asyncpg pool + schema bootstrap + tiny query helpers.

All state (Repo/Seam/Campaign/Unit/UnitEvent) lives in Postgres per
PROJECT.md section 6. Every unit status change is additionally persisted as a
unit_events row (audit trail, section 3 logging convention).
"""

import json
import logging
from pathlib import Path
from typing import Any

import asyncpg

import config

logger = logging.getLogger("migration_foreman.db")

_pool: asyncpg.Pool | None = None

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(config.DATABASE_URL, min_size=1, max_size=10)
    async with _pool.acquire() as conn:
        await conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    logger.info("Postgres pool ready, schema bootstrapped")


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized (is Postgres up?)")
    return _pool


async def fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    async with pool().acquire() as conn:
        return await conn.fetchrow(query, *args)


async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    async with pool().acquire() as conn:
        return await conn.fetch(query, *args)


async def execute(query: str, *args: Any) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(query, *args)


async def record_unit_event(
    unit_id: str, event_type: str, message: str, metadata: dict | None = None
) -> None:
    await execute(
        "INSERT INTO unit_events (unit_id, event_type, message, metadata) "
        "VALUES ($1, $2, $3, $4::jsonb)",
        unit_id,
        event_type,
        message,
        json.dumps(metadata) if metadata is not None else None,
    )
