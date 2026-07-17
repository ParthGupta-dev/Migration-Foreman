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
import repo_config
from shell import run

# Failure logs starting with this marker mean the dependency install broke,
# not the migration or the tests. The gate surfaces it as its own status
# message and it leads every affected failure log in the UI.
INSTALL_FAILURE_MARKER = "[dependency_install_failed]"


def _install_command(worktree_path: Path) -> str | None:
    """Infer the dependency-install command from manifests in the worktree root.

    Lockfile picks the JS package manager (mirrors repo_config's runner
    choice); requirements*.txt (every variant -- requirements.txt,
    requirements-dev.txt, ... -- see repo_config.requirement_files, the same
    scan the test-framework detector uses) beats pyproject.toml for Python,
    since a declared dev/test dependency like pytest must actually be
    installed for a command that was inferred to need it. None = no
    recognized manifest = no install step (e.g. the stdlib-only demo repo).
    """
    if (worktree_path / "package.json").is_file():
        if (worktree_path / "pnpm-lock.yaml").is_file():
            return "pnpm install"
        if (worktree_path / "yarn.lock").is_file():
            return "yarn install"
        return "npm install"
    req_files = sorted(path.name for path in repo_config.requirement_files(worktree_path))
    if req_files:
        return "pip install " + " ".join(f"-r {name}" for name in req_files)
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
