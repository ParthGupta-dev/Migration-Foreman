"""Verification Gate: per-unit attempt loop — run tests, retry with the real
failure log (max 3 attempts), then classify the terminal outcome.

Status flow per unit: pending -> running -> passed
                                 |-> failed -> retrying -> ... -> one of:
                                       escalated          repo verification
                                                           genuinely failed
                                                           (or a merge
                                                           conflict) -> needs
                                                           human review
                                       blocked            every attempt was
                                                           blocked by an LLM/
                                                           provider failure
                                                           (429, timeout,
                                                           empty response,
                                                           provider down) --
                                                           never reached a
                                                           real verification
                                       generation_failed  the model responded
                                                           but never produced
                                                           usable migration
                                                           content
                                       system_error        an unexpected
                                                           internal/
                                                           environment
                                                           failure (not a
                                                           provider issue,
                                                           not a test result)

Only "escalated" belongs in the human Review queue — the other three
terminal states are infrastructure/system noise, not engineering judgement
calls, and the frontend (EscalationPanel) filters strictly on status ==
"escalated" so they never appear there.

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

STATUS_PASSED = "passed"
STATUS_ESCALATED = "escalated"
STATUS_BLOCKED = "blocked"
STATUS_GENERATION_FAILED = "generation_failed"
STATUS_SYSTEM_ERROR = "system_error"

# unit_escalated is the human Review queue's live feed; every other terminal
# failure broadcasts unit_blocked instead, so infra/system noise never lands
# in that queue even before the next campaign snapshot refetch.
_REVIEW_QUEUE_EVENT = "unit_escalated"
_NON_REVIEW_EVENT = "unit_blocked"


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
    attempt = 0

    # Classification state, updated as attempts play out:
    # - verification_ran: True once a real test command has executed for
    #   this unit (even if it failed) -- once True it stays True, because a
    #   later transient provider hiccup doesn't erase the fact that the
    #   migration was actually generated and tested.
    # - last_infra_category: which non-verification failure the most recent
    #   attempt hit (blocked or generation_failed), used as the tiebreaker
    #   when verification never ran at all.
    verification_ran = False
    last_infra_category: str | None = None

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
                    seam.get("provider"),
                )
            except codex.CodexInvocationError as exc:
                # LLM/provider infra failure (429, timeout, empty response,
                # provider unavailable/unconfigured) -- consumes a retry
                # attempt but must never be mistaken for a bad migration.
                failure_log = str(exc)
                last_infra_category = STATUS_BLOCKED
                logger.error("Unit %s attempt %d LLM/provider failure: %s", unit_id, attempt, exc)
                await db.execute(
                    "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
                )
                await set_unit_status(
                    campaign_id, unit_id, "failed", attempt,
                    f"LLM provider call failed on attempt {attempt}",
                    {"category": STATUS_BLOCKED},
                )
                continue

            if content.strip() and not (migrated and migrated.strip()):
                # The model responded, but there is no usable patch to even
                # write to disk and test -- distinct from a provider outage.
                # Guarded on the input having real content: a file that was
                # already empty (e.g. __init__.py) legitimately "migrates"
                # to empty output, which is not a generation failure.
                failure_log = (
                    f"Model produced no usable migration content on attempt {attempt}"
                    + (f"\n{rationale}" if rationale else "")
                )
                last_infra_category = STATUS_GENERATION_FAILED
                logger.warning(
                    "Unit %s attempt %d produced no usable migration content", unit_id, attempt
                )
                await db.execute(
                    "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
                )
                await set_unit_status(
                    campaign_id, unit_id, "failed", attempt,
                    f"No usable migration generated on attempt {attempt}",
                    {"category": STATUS_GENERATION_FAILED},
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
            # A real repository verification just ran -- from here on this
            # unit's story is "verification failed", not "never got there".
            verification_ran = True
            # Full test output is kept on pass AND fail so the preview view
            # can show it alongside the migrated file.
            await db.execute(
                "UPDATE units SET test_log = $1 WHERE unit_id = $2", log, unit_id
            )

            if passed:
                try:
                    async with repo_lock:
                        await asyncio.to_thread(
                            worktree.merge_unit, repo_path, campaign_branch, unit_branch
                        )
                except RuntimeError as exc:
                    # Tests passed but merging into the shared campaign branch
                    # conflicted with another unit's changes -- an engineering
                    # judgement call (per spec), not an infra/system failure.
                    failure_log = f"{failure_log or ''}\n[merge conflict] {exc}".strip()
                    await db.execute(
                        "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
                    )
                    await set_unit_status(
                        campaign_id, unit_id, STATUS_ESCALATED, attempt,
                        f"Tests passed but merge into {campaign_branch} conflicted",
                        {"failureLogTail": failure_log[-1000:]},
                    )
                    await manager.broadcast(
                        campaign_id, _REVIEW_QUEUE_EVENT, {"unitId": unit_id, "failureLog": failure_log}
                    )
                    return STATUS_ESCALATED

                await db.execute("UPDATE units SET failure_log = NULL WHERE unit_id = $1", unit_id)
                await set_unit_status(
                    campaign_id, unit_id, STATUS_PASSED, attempt,
                    f"Tests passed on attempt {attempt}; merged into {campaign_branch}",
                )
                return STATUS_PASSED

            failure_log = log
            last_infra_category = None  # a real verification attempt just ran
            logger.warning("Unit %s attempt %d failed verification", unit_id, attempt)
            await db.execute(
                "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
            )
            # Same retry path either way; the message just names the real
            # culprit so a broken install is never mistaken for a bad migration.
            failed_step = (
                "Dependency install failed"
                if log.startswith(runner.INSTALL_FAILURE_MARKER)
                else "Tests failed"
            )
            await set_unit_status(
                campaign_id, unit_id, "failed", attempt,
                f"{failed_step} on attempt {attempt}",
                {"failureLogTail": log[-1000:]},
            )

        # Retry cap reached -- classify the terminal outcome from what
        # actually happened across attempts, instead of always escalating.
        if verification_ran:
            final_status = STATUS_ESCALATED
            final_message = (
                f"Escalated after {config.MAX_ATTEMPTS} attempts: "
                "repository verification kept failing"
            )
        elif last_infra_category == STATUS_GENERATION_FAILED:
            final_status = STATUS_GENERATION_FAILED
            final_message = (
                f"No valid migration could be generated after {config.MAX_ATTEMPTS} attempts"
            )
        else:
            final_status = STATUS_BLOCKED
            final_message = (
                f"Blocked after {config.MAX_ATTEMPTS} attempts: the LLM provider "
                "never returned a usable response"
            )

        await set_unit_status(campaign_id, unit_id, final_status, config.MAX_ATTEMPTS, final_message)
        event = _REVIEW_QUEUE_EVENT if final_status == STATUS_ESCALATED else _NON_REVIEW_EVENT
        await manager.broadcast(
            campaign_id, event,
            {"unitId": unit_id, "status": final_status, "failureLog": failure_log or ""},
        )
        return final_status

    except Exception as exc:
        # Unexpected internal/environment failure -- not a provider issue and
        # not a test result, so it must not pollute either the human Review
        # queue or the blocked/generation-failed buckets.
        logger.error("Unit %s crashed: %s", unit_id, exc)
        failure_log = f"{failure_log or ''}\n[system error] {exc}".strip()
        await db.execute(
            "UPDATE units SET failure_log = $1 WHERE unit_id = $2", failure_log, unit_id
        )
        await set_unit_status(
            campaign_id, unit_id, STATUS_SYSTEM_ERROR, attempt, f"System error: {exc}"
        )
        await manager.broadcast(
            campaign_id, _NON_REVIEW_EVENT,
            {"unitId": unit_id, "status": STATUS_SYSTEM_ERROR, "failureLog": failure_log},
        )
        return STATUS_SYSTEM_ERROR

    finally:
        if worktree_path is not None:
            async with repo_lock:
                await asyncio.to_thread(
                    worktree.remove_worktree, repo_path, worktree_path, unit_branch
                )


def _commit_attempt(worktree_path: Path, scope_glob: str, attempt: int) -> None:
    from shell import run_git

    # Test runs inside the worktree generate bytecode/caches between attempts;
    # committing them causes add/add binary conflicts when unit branches merge
    # into the campaign branch, so they are excluded from the unit commit.
    run_git(
        [
            "add", "-A", "--", ".",
            ":(exclude,glob)**/__pycache__/**",
            ":(exclude,glob)**/*.pyc",
            ":(exclude,glob)**/.pytest_cache/**",
            ":(exclude,glob)**/node_modules/**",
        ],
        cwd=worktree_path,
    )
    run_git(
        [*worktree.GIT_IDENTITY, "commit", "--allow-empty", "-m",
         f"migrate {scope_glob} (attempt {attempt})"],
        cwd=worktree_path,
    )


def _diff_against_base(worktree_path: Path, base_branch: str) -> str:
    from shell import run_git

    result = run_git(["diff", f"{base_branch}...HEAD"], cwd=worktree_path)
    return result.stdout if result.ok else ""
