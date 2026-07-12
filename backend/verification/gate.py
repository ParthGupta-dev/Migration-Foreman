"""Verification Gate: per-unit attempt loop — run tests, retry with the real
failure log (max 3 attempts), escalate after the cap.

Status flow per unit: pending -> running -> passed
                                 |-> failed -> retrying -> ... -> escalated
Every transition is persisted as a unit_events row and broadcast on the
campaign WebSocket room.
"""

import asyncio
import logging
from pathlib import Path

import db
import config
from execution import codex, worktree
from verification import runner
from ws import manager

logger = logging.getLogger("migration_foreman.gate")


async def set_unit_status(
    campaign_id: str,
    unit_id: str,
    status: str,
    attempt: int,
    message: str,
    metadata: dict | None = None,
) -> None:
    await db.execute(
        "UPDATE units SET status = $1, attempt = $2 WHERE unit_id = $3",
        status,
        attempt,
        unit_id,
    )
    await db.record_unit_event(unit_id, "status_change", message, {"status": status, "attempt": attempt, **(metadata or {})})
    await manager.broadcast(
        campaign_id, "unit_status", {"unitId": unit_id, "status": status, "attempt": attempt}
    )


async def _reasoning(campaign_id: str, unit_id: str, text: str) -> None:
    await manager.broadcast(campaign_id, "unit_reasoning", {"unitId": unit_id, "text": text})


async def run_unit(
    campaign_id: str,
    unit_id: str,
    scope_glob: str,
    seam: dict,
    repo_path: Path,
    campaign_branch: str,
    repo_lock: asyncio.Lock,
) -> str:
    """Execute one unit end-to-end. Returns the unit's final status.

    repo_lock serializes every git operation that touches the main repo
    (worktree add/remove, merges) — concurrent git processes there contend
    on .git files. Tests and Codex calls still run in parallel.
    """
    worktree_path: Path | None = None
    unit_branch: str | None = None
    failure_log: str | None = None

    try:
        async with repo_lock:
            worktree_path, unit_branch = await asyncio.to_thread(
                worktree.create_worktree, repo_path, unit_id, campaign_branch
            )
        target = worktree_path / scope_glob
        if not target.is_file():
            raise RuntimeError(f"Unit file not found in worktree: {scope_glob}")

        for attempt in range(1, config.MAX_ATTEMPTS + 1):
            status = "running" if attempt == 1 else "retrying"
            await set_unit_status(
                campaign_id, unit_id, status, attempt,
                f"Attempt {attempt}/{config.MAX_ATTEMPTS} on {scope_glob}",
            )
            await _reasoning(
                campaign_id, unit_id,
                f"[attempt {attempt}] Invoking Codex on {scope_glob} "
                f"({seam['beforePattern']} -> {seam['afterPattern']})",
            )

            try:
                content = target.read_text(encoding="utf-8", errors="replace")
                migrated, rationale = await asyncio.to_thread(
                    codex.migrate_file,
                    scope_glob,
                    content,
                    seam["beforePattern"],
                    seam["afterPattern"],
                    seam["invariants"],
                    failure_log,
                )
            except codex.CodexInvocationError as exc:
                # Fallback plan (section 11): a Codex API failure consumes a
                # retry attempt like any failed verification, no special-casing.
                failure_log = str(exc)
                logger.error("Unit %s attempt %d Codex failure: %s", unit_id, attempt, exc)
                await db.execute(
                    "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
                )
                await set_unit_status(
                    campaign_id, unit_id, "failed", attempt,
                    f"Codex invocation failed on attempt {attempt}",
                )
                continue

            if rationale:
                await _reasoning(campaign_id, unit_id, f"[attempt {attempt}] {rationale}")
                await db.record_unit_event(unit_id, "codex_rationale", rationale, {"attempt": attempt})

            target.write_text(migrated, encoding="utf-8")
            await asyncio.to_thread(_commit_attempt, worktree_path, scope_glob, attempt)

            diff = await asyncio.to_thread(_diff_against_base, worktree_path, campaign_branch)
            await db.execute("UPDATE units SET diff = $1 WHERE unit_id = $2", diff, unit_id)

            await _reasoning(campaign_id, unit_id, f"[attempt {attempt}] Running tests: {seam['testCommand']}")
            passed, log = await runner.run_tests(worktree_path, seam["testCommand"])
            # Full test output is kept on pass AND fail so the preview view
            # can show it alongside the migrated file.
            await db.execute(
                "UPDATE units SET test_log = $1 WHERE unit_id = $2", log, unit_id
            )

            if passed:
                async with repo_lock:
                    await asyncio.to_thread(
                        worktree.merge_unit, repo_path, campaign_branch, unit_branch
                    )
                await db.execute("UPDATE units SET failure_log = NULL WHERE unit_id = $1", unit_id)
                await set_unit_status(
                    campaign_id, unit_id, "passed", attempt,
                    f"Tests passed on attempt {attempt}; merged into {campaign_branch}",
                )
                return "passed"

            failure_log = log
            logger.warning("Unit %s attempt %d failed verification", unit_id, attempt)
            await db.execute(
                "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
            )
            await set_unit_status(
                campaign_id, unit_id, "failed", attempt,
                f"Tests failed on attempt {attempt}",
                {"failureLogTail": log[-1000:]},
            )

        # Retry cap reached -> escalate to the human review queue.
        await set_unit_status(
            campaign_id, unit_id, "escalated", config.MAX_ATTEMPTS,
            f"Escalated after {config.MAX_ATTEMPTS} failed attempts",
        )
        await manager.broadcast(
            campaign_id, "unit_escalated", {"unitId": unit_id, "failureLog": failure_log or ""}
        )
        return "escalated"

    except Exception as exc:
        logger.error("Unit %s crashed: %s", unit_id, exc)
        failure_log = f"{failure_log or ''}\n[unit crash] {exc}".strip()
        await db.execute(
            "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
        )
        await set_unit_status(campaign_id, unit_id, "escalated", config.MAX_ATTEMPTS, f"Unit crashed: {exc}")
        await manager.broadcast(
            campaign_id, "unit_escalated", {"unitId": unit_id, "failureLog": failure_log}
        )
        return "escalated"

    finally:
        if worktree_path is not None:
            async with repo_lock:
                await asyncio.to_thread(
                    worktree.remove_worktree, repo_path, worktree_path, unit_branch
                )


def _commit_attempt(worktree_path: Path, scope_glob: str, attempt: int) -> None:
    from shell import run_git

    run_git(["add", "-A"], cwd=worktree_path)
    run_git(
        [*worktree.GIT_IDENTITY, "commit", "--allow-empty", "-m",
         f"migrate {scope_glob} (attempt {attempt})"],
        cwd=worktree_path,
    )


def _diff_against_base(worktree_path: Path, base_branch: str) -> str:
    from shell import run_git

    result = run_git(["diff", f"{base_branch}...HEAD"], cwd=worktree_path)
    return result.stdout if result.ok else ""
