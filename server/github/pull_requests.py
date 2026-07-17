"""Branch push + PR creation against a specific repo, via an authenticated client."""

import logging
from pathlib import Path

from github.client import GithubClient
from shell import run_git

logger = logging.getLogger("migration_foreman.github.pull_requests")


class PullRequestError(Exception):
    pass


def push_branch(repo_path: Path, campaign_branch: str, owner: str, repo: str, token: str) -> None:
    push_url = f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"
    result = run_git(
        ["push", "--force", push_url, f"{campaign_branch}:{campaign_branch}"], cwd=repo_path
    )
    if not result.ok:
        raise PullRequestError(f"Failed to push campaign branch: {result.output[-500:]}")


def open_pull_request(
    client: GithubClient, owner: str, repo: str, title: str, head: str, base: str, body: str
) -> dict:
    data = client.post(
        f"/repos/{owner}/{repo}/pulls",
        {"title": title, "head": head, "base": base, "body": body},
    )
    pr_url = data.get("html_url") if data else None
    if not pr_url:
        raise PullRequestError("GitHub API response missing html_url")
    logger.info("Opened PR %s", pr_url)
    return {"url": pr_url, "number": data.get("number")}
