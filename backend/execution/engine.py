"""Execution Engine campaign runner.

Creates the campaign branch, runs units in parallel (bounded by
UNIT_PARALLELISM; set to 1 for the sequential fallback in section 11), and
settles the campaign status when all units resolve.
"""

import asyncio
import logging
from pathlib import Path

import db
import config
from execution import worktree
from verification import gate
from ws import manager

logger = logging.getLogger("migration_foreman.engine")


async def run_campaign(campaign_id: str, seam: dict, repo_path: Path) -> None:
    await manager.broadcast(campaign_id, "campaign_started", {"campaignId": campaign_id})

    try:
        campaign_branch = await asyncio.to_thread(
            worktree.prepare_campaign_branch, repo_path, campaign_id
        )
    except Exception as exc:
        logger.error("Campaign %s failed to prepare branch: %s", campaign_id, exc)
        await _fail_campaign(campaign_id, f"Failed to prepare campaign branch: {exc}")
        return

    units = await db.fetch(
        "SELECT unit_id, scope_glob FROM units WHERE campaign_id = $1 ORDER BY created_at",
        campaign_id,
    )
    logger.info("Campaign %s started with %d units", campaign_id, len(units))

    semaphore = asyncio.Semaphore(config.UNIT_PARALLELISM)
    repo_lock = asyncio.Lock()  # serializes main-repo git ops across units

    async def bounded_run(unit_id: str, scope_glob: str) -> str:
        async with semaphore:
            return await gate.run_unit(
                campaign_id, unit_id, scope_glob, seam, repo_path, campaign_branch, repo_lock
            )

    try:
        results = await asyncio.gather(
            *(bounded_run(str(unit["unit_id"]), unit["scope_glob"]) for unit in units)
        )
    except Exception as exc:
        logger.error("Campaign %s crashed: %s", campaign_id, exc)
        await _fail_campaign(campaign_id, str(exc))
        return

    await db.execute(
        "UPDATE campaigns SET status = 'completed' WHERE campaign_id = $1", campaign_id
    )
    logger.info(
        "Campaign %s completed: %d passed, %d escalated, %d blocked, "
        "%d generation_failed, %d system_error",
        campaign_id,
        results.count("passed"),
        results.count("escalated"),
        results.count("blocked"),
        results.count("generation_failed"),
        results.count("system_error"),
    )
    await manager.broadcast(campaign_id, "campaign_completed", {"campaignId": campaign_id})


async def _fail_campaign(campaign_id: str, reason: str) -> None:
    await db.execute(
        "UPDATE campaigns SET status = 'failed' WHERE campaign_id = $1", campaign_id
    )
    await manager.broadcast(campaign_id, "campaign_failed", {"reason": reason})
