"""PR assembly via the GitHub REST API (stdlib urllib — no extra dependency).

Pushes the campaign branch (which already contains every merged/accepted
unit) and opens one PR against the repo's default branch, with escalated
units listed separately in the description for manual follow-up.

Requires a github.com repoUrl and GITHUB_TOKEN. Anything else raises
PrCreationError -> the API returns 502 pr_creation_failed and the frontend
falls back to showing the aggregated diffs (fallback plan, section 11).
"""

import json
import logging
import re
import urllib.error
import urllib.request
from pathlib import Path

import config
from execution import worktree
from shell import run_git

logger = logging.getLogger("migration_foreman.pr")

_GITHUB_URL = re.compile(r"github\.com[:/]([\w.\-]+)/([\w.\-]+?)(?:\.git)?/?$")


class PrCreationError(Exception):
    pass


def _parse_github(repo_url: str) -> tuple[str, str]:
    match = _GITHUB_URL.search(repo_url)
    if not match:
        raise PrCreationError(f"Not a GitHub repo URL: {repo_url}")
    return match.group(1), match.group(2)


def create_pr(
    repo_url: str,
    repo_path: Path,
    campaign_branch: str,
    accepted: list[str],
    escalated: list[dict],
) -> str:
    """Push the campaign branch and open the aggregate PR. Returns the PR URL."""
    if not config.GITHUB_TOKEN:
        raise PrCreationError("GITHUB_TOKEN not set")
    owner, repo = _parse_github(repo_url)

    push_url = f"https://x-access-token:{config.GITHUB_TOKEN}@github.com/{owner}/{repo}.git"
    push = run_git(["push", "--force", push_url, f"{campaign_branch}:{campaign_branch}"], cwd=repo_path)
    if not push.ok:
        raise PrCreationError(f"Failed to push campaign branch: {push.output[-500:]}")

    body_lines = ["## Migration Foreman — verified migration campaign", ""]
    body_lines.append(f"**Accepted units ({len(accepted)})** — each passed the seam's test command:")
    body_lines += [f"- `{glob}`" for glob in accepted] or ["- (none)"]
    body_lines += ["", f"**Escalated units ({len(escalated)})** — require manual follow-up:"]
    if escalated:
        for unit in escalated:
            body_lines.append(f"- `{unit['scopeGlob']}` — failed after {unit['attempt']} attempts")
    else:
        body_lines.append("- (none)")

    payload = json.dumps(
        {
            "title": f"Migration Foreman: {campaign_branch}",
            "head": campaign_branch,
            "base": worktree.default_branch(repo_path),
            "body": "\n".join(body_lines),
        }
    ).encode()
    request = urllib.request.Request(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {config.GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "migration-foreman",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise PrCreationError(f"GitHub API {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise PrCreationError(f"GitHub API unreachable: {exc.reason}") from exc

    pr_url = data.get("html_url")
    if not pr_url:
        raise PrCreationError("GitHub API response missing html_url")
    logger.info("Opened PR %s", pr_url)
    return pr_url
