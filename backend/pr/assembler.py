"""PR assembly — thin wrapper over services/github_service.py.

The migration engine (and main.py's finalize endpoint) call create_pr()
without knowing whether the token behind it came from an OAuth session, a
manually pasted token, or the GITHUB_TOKEN env fallback; that resolution
lives entirely in services/github_service.py + auth/*. This module only
keeps the historical PrCreationError name so existing call sites don't need
to change their except clauses.
"""

from pathlib import Path

from services import github_service


class PrCreationError(Exception):
    pass


async def create_pr(
    repo_url: str,
    repo_path: Path,
    campaign_branch: str,
    accepted: list[str],
    escalated: list[dict],
    token: str | None = None,
    session_id: str | None = None,
) -> str:
    """Push the campaign branch and open the aggregate PR. Returns the PR URL.

    `token` is a UI-supplied GitHub token (manual-paste fallback); `session_id`
    is the OAuth session cookie value, which takes precedence when present.
    """
    try:
        return await github_service.create_pull_request_for_campaign(
            session_id=session_id,
            repo_url=repo_url,
            repo_path=repo_path,
            campaign_branch=campaign_branch,
            accepted=accepted,
            escalated=escalated,
            fallback_token=token,
        )
    except github_service.GithubServiceError as exc:
        raise PrCreationError(str(exc)) from exc
