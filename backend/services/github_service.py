"""Facade the API layer and migration engine use for all GitHub access.

Nothing outside auth/*, github/*, and this module should call the GitHub API
or touch OAuth/session internals — GitHub authentication is an
infrastructure concern, not something the migration engine (pr/assembler.py,
execution/*) should know the shape of. Callers ask this facade for a client
or an operation; they never see whether the token came from an OAuth
session, a manually pasted token, or the GITHUB_TOKEN env fallback.
"""

import asyncio
import logging
import re
from pathlib import Path

import config
from auth import session as session_store
from execution import worktree
from github import pull_requests, repositories
from github.client import GithubApiError, GithubClient

logger = logging.getLogger("migration_foreman.services.github")

_GITHUB_URL = re.compile(r"github\.com[:/]([\w.\-]+)/([\w.\-]+?)(?:\.git)?/?$")


class GithubServiceError(Exception):
    pass


async def get_client(session_id: str | None, fallback_token: str | None = None) -> GithubClient | None:
    """Resolve a usable client. Precedence: OAuth session > fallback_token
    (manual-token UI / request body) > GITHUB_TOKEN env var."""
    token = await session_store.get_access_token(session_id)
    token = token or (fallback_token or "").strip() or config.GITHUB_TOKEN
    return GithubClient(token) if token else None


async def list_repositories(session_id: str | None) -> list[dict]:
    client = await get_client(session_id)
    if client is None:
        raise GithubServiceError("Not authenticated: connect GitHub first")
    try:
        return await asyncio.to_thread(repositories.list_repositories, client)
    except GithubApiError as exc:
        raise GithubServiceError(str(exc)) from exc


async def get_repository(session_id: str | None, owner: str, repo: str) -> dict:
    client = await get_client(session_id)
    if client is None:
        raise GithubServiceError("Not authenticated: connect GitHub first")
    try:
        return await asyncio.to_thread(repositories.get_repository, client, owner, repo)
    except GithubApiError as exc:
        raise GithubServiceError(str(exc)) from exc


def _parse_github_url(repo_url: str) -> tuple[str, str]:
    match = _GITHUB_URL.search(repo_url)
    if not match:
        raise GithubServiceError(f"Not a GitHub repo URL: {repo_url}")
    return match.group(1), match.group(2)


async def create_pull_request_for_campaign(
    session_id: str | None,
    repo_url: str,
    repo_path: Path,
    campaign_branch: str,
    accepted: list[str],
    escalated: list[dict],
    title: str | None = None,
    body: str | None = None,
    fallback_token: str | None = None,
) -> str:
    """Push the campaign branch and open the aggregate PR. Returns the PR URL.

    Token precedence: OAuth session > fallback_token (manual-token UI /
    request body) > GITHUB_TOKEN env var (assembler's original fallback).
    """
    client = await get_client(session_id, fallback_token)
    if client is None:
        raise GithubServiceError("No GitHub token: connect GitHub or set GITHUB_TOKEN")
    owner, repo = _parse_github_url(repo_url)

    try:
        await asyncio.to_thread(
            pull_requests.push_branch, repo_path, campaign_branch, owner, repo, client.token
        )
    except pull_requests.PullRequestError as exc:
        raise GithubServiceError(str(exc)) from exc

    if body:
        body_lines = [body]
    else:
        body_lines = ["## Migration Foreman — verified migration campaign", ""]
        body_lines.append(f"**Accepted units ({len(accepted)})** — each passed the seam's test command:")
        body_lines += [f"- `{glob}`" for glob in accepted] or ["- (none)"]
        body_lines += ["", f"**Escalated units ({len(escalated)})** — require manual follow-up:"]
        if escalated:
            body_lines += [
                f"- `{unit['scopeGlob']}` — failed after {unit['attempt']} attempts" for unit in escalated
            ]
        else:
            body_lines.append("- (none)")

    try:
        base_branch = await asyncio.to_thread(worktree.default_branch, repo_path)
        result = await asyncio.to_thread(
            pull_requests.open_pull_request,
            client, owner, repo,
            title or f"Migration Foreman: {campaign_branch}",
            campaign_branch,
            base_branch,
            "\n".join(body_lines),
        )
    except (pull_requests.PullRequestError, GithubApiError) as exc:
        raise GithubServiceError(str(exc)) from exc
    return result["url"]
