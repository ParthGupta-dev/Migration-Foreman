"""Git worktree lifecycle: one isolated worktree + branch per unit.

Also owns the campaign branch (mf/campaign-<id8>) that passed units merge
into, and the final merge helper used by the Verification Gate.
"""

import logging
import shutil
import time
from pathlib import Path

import config
from shell import run_git

logger = logging.getLogger("migration_foreman.worktree")

GIT_IDENTITY = [
    "-c", "user.name=Migration Foreman",
    "-c", "user.email=foreman@migration-foreman.local",
]


def default_branch(repo_path: Path) -> str:
    result = run_git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd=repo_path)
    if result.ok:
        return result.stdout.strip().removeprefix("origin/")
    for branch in ("main", "master"):
        if run_git(["rev-parse", "--verify", branch], cwd=repo_path).ok:
            return branch
    return run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path).stdout.strip() or "main"


def prepare_campaign_branch(repo_path: Path, campaign_id: str) -> str:
    branch = f"mf/campaign-{campaign_id[:8]}"
    base = default_branch(repo_path)
    result = run_git(["checkout", "-B", branch, base], cwd=repo_path)
    if not result.ok:
        raise RuntimeError(f"Failed to create campaign branch {branch}: {result.output}")
    return branch


def create_worktree(repo_path: Path, unit_id: str, base_branch: str) -> tuple[Path, str]:
    branch = f"mf/unit-{unit_id[:8]}"
    worktree_path = config.WORKTREES_DIR / unit_id[:8]
    if worktree_path.exists():
        remove_worktree(repo_path, worktree_path, branch)
    result = run_git(
        ["worktree", "add", "-b", branch, str(worktree_path), base_branch],
        cwd=repo_path,
    )
    if not result.ok:
        raise RuntimeError(f"Failed to create worktree for unit {unit_id}: {result.output}")
    return worktree_path, branch


def remove_worktree(repo_path: Path, worktree_path: Path, branch: str | None = None) -> None:
    run_git(["worktree", "remove", "--force", str(worktree_path)], cwd=repo_path)
    if worktree_path.exists():
        shutil.rmtree(worktree_path, ignore_errors=True)
    run_git(["worktree", "prune"], cwd=repo_path)
    if branch:
        run_git(["branch", "-D", branch], cwd=repo_path)


def merge_unit(repo_path: Path, campaign_branch: str, unit_branch: str) -> None:
    """Merge a passed unit's branch into the campaign branch (in the main repo).

    Callers must hold the campaign's repo lock — git operations on the main
    repo cannot run concurrently (transient .git file locking, esp. Windows).
    A short retry absorbs any leftover transient lock from worktree commits.
    """
    last_output = ""
    for _ in range(3):
        checkout = run_git(["checkout", campaign_branch], cwd=repo_path)
        if checkout.ok:
            merge = run_git(
                [*GIT_IDENTITY, "merge", "--no-ff", unit_branch, "-m", f"merge {unit_branch}"],
                cwd=repo_path,
            )
            if merge.ok:
                return
            run_git(["merge", "--abort"], cwd=repo_path)
            last_output = merge.output
        else:
            last_output = checkout.output
        time.sleep(0.5)
    raise RuntimeError(f"Merge of {unit_branch} failed: {last_output}")
