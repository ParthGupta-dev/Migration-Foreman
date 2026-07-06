"""Test runner wrapper: executes the seam's test_command inside a unit's
worktree and captures stdout/stderr (PROJECT.md Verification Gate)."""

import asyncio
from pathlib import Path

import config
from shell import run


async def run_tests(worktree_path: Path, test_command: str) -> tuple[bool, str]:
    """Run the seam's test command in the worktree. Returns (passed, log)."""
    result = await asyncio.to_thread(
        run,
        test_command,
        cwd=worktree_path,
        timeout=config.TEST_TIMEOUT_SECONDS,
        shell=True,
    )
    return result.ok, result.output
