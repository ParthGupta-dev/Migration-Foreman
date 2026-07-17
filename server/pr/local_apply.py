"""Apply a completed campaign's verified changes to the local repository.

The default publishing path — no GitHub authentication involved. The campaign
branch already contains every accepted (test-verified) unit; applying locally
means merging it into the repo's default branch in the backend's clone. The
caller gets everything needed to take it from there by hand: the clone path,
the changed files, a diff summary, and the git commands to push.

PR creation (pr/assembler.py) is the optional alternative for users who
connect GitHub.
"""

import logging
from pathlib import Path

from execution import worktree
from shell import run_git

logger = logging.getLogger("migration_foreman.local_apply")


class LocalApplyError(Exception):
    pass


def apply_local(repo_path: Path, campaign_branch: str) -> dict:
    """Merge the campaign branch into the default branch. Idempotent.

    Returns localPath, branches, changed files, diff summary, and suggested
    git commands. A second call after a successful merge reports
    alreadyApplied=True instead of failing.
    """
    if not run_git(["rev-parse", "--verify", campaign_branch], cwd=repo_path).ok:
        raise LocalApplyError(f"Campaign branch {campaign_branch} not found in the clone")

    base_branch = worktree.default_branch(repo_path)

    # Three-dot diff (from the merge base) so the numbers reflect exactly what
    # the campaign introduced; captured before merging, when it is non-empty.
    changed = run_git(
        ["diff", "--name-only", f"{base_branch}...{campaign_branch}"], cwd=repo_path
    )
    changed_files = [line for line in changed.stdout.splitlines() if line.strip()]
    stat = run_git(
        ["diff", "--stat", f"{base_branch}...{campaign_branch}"], cwd=repo_path
    )
    diff_summary = stat.stdout.strip()

    already_applied = not changed_files

    if not already_applied:
        checkout = run_git(["checkout", base_branch], cwd=repo_path)
        if not checkout.ok:
            raise LocalApplyError(f"Failed to checkout {base_branch}: {checkout.output[-500:]}")
        merge = run_git(
            [
                *worktree.GIT_IDENTITY,
                "merge", "--no-ff", campaign_branch,
                "-m", f"Migration Foreman: {campaign_branch}",
            ],
            cwd=repo_path,
        )
        if not merge.ok:
            run_git(["merge", "--abort"], cwd=repo_path)
            raise LocalApplyError(f"Merge into {base_branch} failed: {merge.output[-500:]}")
        logger.info("Applied %s locally onto %s", campaign_branch, base_branch)

    return {
        "localPath": str(repo_path),
        "baseBranch": base_branch,
        "campaignBranch": campaign_branch,
        "changedFiles": changed_files,
        "diffSummary": diff_summary,
        "alreadyApplied": already_applied,
        # The merge is already committed on the base branch; these are the
        # honest next steps from the clone (shown with a Copy button in the UI).
        "gitCommands": [
            f'cd "{repo_path}"',
            "git status",
            "git log --oneline -5",
            "git push",
        ],
    }
