"""Test runner wrapper: executes the seam's test_command inside a unit's
worktree and captures stdout/stderr (PROJECT.md Verification Gate).

Before the test command runs, project dependencies are installed into the
worktree when a manifest is present (package.json -> npm/pnpm/yarn,
requirements.txt / pyproject.toml -> pip). A fresh `git worktree add` has no
node_modules or installed packages, so real repos would otherwise fail every
unit with a missing-module error that looks like a migration failure. An
install failure is reported with a distinct marker so the UI can tell it
apart from a genuine test failure.
"""

import asyncio
from pathlib import Path

import config
from shell import run

# Failure logs starting with this marker mean the dependency install broke,
# not the migration or the tests. The gate surfaces it as its own status
# message and it leads every affected failure log in the UI.
INSTALL_FAILURE_MARKER = "[dependency_install_failed]"


def _install_command(worktree_path: Path) -> str | None:
    """Infer the dependency-install command from manifests in the worktree root.

    Lockfile picks the JS package manager (mirrors repo_config's runner
    choice); requirements.txt beats pyproject.toml for Python. None = no
    recognized manifest = no install step (e.g. the stdlib-only demo repo).
    """
    if (worktree_path / "package.json").is_file():
        if (worktree_path / "pnpm-lock.yaml").is_file():
            return "pnpm install"
        if (worktree_path / "yarn.lock").is_file():
            return "yarn install"
        return "npm install"
    if (worktree_path / "requirements.txt").is_file():
        return "pip install -r requirements.txt"
    if (worktree_path / "pyproject.toml").is_file():
        return "pip install ."
    return None


async def run_tests(worktree_path: Path, test_command: str) -> tuple[bool, str]:
    """Install dependencies (when a manifest asks for it), then run the seam's
    test command in the worktree. Returns (passed, log)."""
    install = _install_command(worktree_path)
    if install is not None:
        result = await asyncio.to_thread(
            run,
            install,
            cwd=worktree_path,
            timeout=config.INSTALL_TIMEOUT_SECONDS,
            shell=True,
        )
        if not result.ok:
            return False, (
                f"{INSTALL_FAILURE_MARKER} {install!r} failed before the test "
                f"command could run:\n{result.output}"
            )

    result = await asyncio.to_thread(
        run,
        test_command,
        cwd=worktree_path,
        timeout=config.TEST_TIMEOUT_SECONDS,
        shell=True,
    )
    return result.ok, result.output
