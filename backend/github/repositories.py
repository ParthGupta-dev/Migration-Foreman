"""Repository listing/metadata for an authenticated GitHub user."""

from github.client import GithubClient


def _normalize(repo: dict) -> dict:
    return {
        "owner": repo["owner"]["login"],
        "name": repo["name"],
        "fullName": repo["full_name"],
        "defaultBranch": repo.get("default_branch", "main"),
        "private": repo["private"],
        "permissions": repo.get("permissions", {}),
    }


def list_repositories(client: GithubClient, max_pages: int = 5) -> list[dict]:
    """GET /user/repos, paginated at 100/page up to max_pages."""
    repos: list[dict] = []
    for page in range(1, max_pages + 1):
        batch = client.get(
            "/user/repos",
            params={"per_page": 100, "page": page, "sort": "updated", "affiliation": "owner,collaborator"},
        )
        if not batch:
            break
        repos.extend(_normalize(repo) for repo in batch)
        if len(batch) < 100:
            break
    return repos


def get_repository(client: GithubClient, owner: str, repo: str) -> dict:
    return _normalize(client.get(f"/repos/{owner}/{repo}"))
