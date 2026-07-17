"""Thin authenticated GitHub REST client.

Holds a bearer token handed to it by services/github_service.py and knows
nothing about where that token came from (OAuth session, manual paste, or
the GITHUB_TOKEN env fallback). Never logs the token.
"""

import json
import logging
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger("migration_foreman.github.client")

_API_BASE = "https://api.github.com"


class GithubApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class GithubClient:
    def __init__(self, token: str) -> None:
        if not token:
            raise ValueError("GithubClient requires a non-empty token")
        self.token = token

    def _headers(self, has_body: bool) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "migration-foreman",
        }
        if has_body:
            headers["Content-Type"] = "application/json"
        return headers

    def request(
        self, method: str, path: str, payload: dict | None = None, params: dict | None = None
    ):
        url = path if path.startswith("http") else f"{_API_BASE}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            url, data=data, method=method, headers=self._headers(data is not None)
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            raise GithubApiError(
                exc.code, f"GitHub API {method} {path} -> {exc.code}: {detail}"
            ) from exc
        except urllib.error.URLError as exc:
            raise GithubApiError(0, f"GitHub API unreachable: {exc.reason}") from exc

    def get(self, path: str, params: dict | None = None):
        return self.request("GET", path, params=params)

    def post(self, path: str, payload: dict):
        return self.request("POST", path, payload=payload)
