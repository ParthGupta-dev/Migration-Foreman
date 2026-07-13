"""GitHub OAuth Authorization Code Flow: CSRF state + code/token exchange.

Stateless w.r.t. users — no session or credential storage happens here (see
auth/session.py for that). The pending-state store is a short-lived
in-memory dict: states are one-shot, live at most _STATE_TTL_SECONDS, and
carry no credential, so unlike sessions they don't need to survive a
backend restart or be encrypted at rest.
"""

import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import config

logger = logging.getLogger("migration_foreman.auth.oauth")

_STATE_TTL_SECONDS = 600  # authorize screens abandoned longer than this are dead

# state -> {"session": session_id, "next": frontend path, "expires": epoch}
_pending_states: dict[str, dict] = {}


class OAuthError(Exception):
    """Code exchange or user lookup failed."""


def configured() -> bool:
    return bool(config.GITHUB_OAUTH_CLIENT_ID and config.GITHUB_OAUTH_CLIENT_SECRET)


def begin(session_id: str, next_path: str) -> str:
    """Mint a fresh CSRF state bound to this session; return the authorize URL."""
    _prune_states()
    state = secrets.token_urlsafe(32)
    _pending_states[state] = {
        "session": session_id,
        "next": next_path,
        "expires": time.time() + _STATE_TTL_SECONDS,
    }
    params = urllib.parse.urlencode({
        "client_id": config.GITHUB_OAUTH_CLIENT_ID,
        "redirect_uri": config.GITHUB_OAUTH_REDIRECT_URI,
        "scope": "repo read:user",
        "state": state,
    })
    return f"https://github.com/login/oauth/authorize?{params}"


def pop_state(state: str) -> dict | None:
    """Consume a pending state (one-shot). None = unknown/expired -> reject."""
    _prune_states()
    return _pending_states.pop(state, None)


def _prune_states() -> None:
    now = time.time()
    for state in [s for s, v in _pending_states.items() if v["expires"] < now]:
        _pending_states.pop(state, None)


def exchange_code(code: str) -> dict:
    """Trade the callback `code` for a token at GitHub's token endpoint.

    Returns {"access_token", "refresh_token", "expires_in"}. refresh_token
    and expires_in are only present for OAuth Apps with expiring tokens
    enabled; both are None/absent for classic non-expiring tokens.
    """
    payload = urllib.parse.urlencode({
        "client_id": config.GITHUB_OAUTH_CLIENT_ID,
        "client_secret": config.GITHUB_OAUTH_CLIENT_SECRET,
        "code": code,
        "redirect_uri": config.GITHUB_OAUTH_REDIRECT_URI,
    }).encode()
    request = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=payload,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "migration-foreman",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read())
    except urllib.error.URLError as exc:
        raise OAuthError(f"GitHub token endpoint unreachable: {exc}") from exc
    token = data.get("access_token")
    if not token:
        raise OAuthError(
            "GitHub rejected the code exchange: "
            f"{data.get('error_description') or data.get('error') or 'no access_token in response'}"
        )
    return {
        "access_token": token,
        "refresh_token": data.get("refresh_token"),
        "expires_in": data.get("expires_in"),
    }


def fetch_user(token: str) -> dict | None:
    """Best-effort GET /user for profile fields shown by /auth/session."""
    request = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "migration-foreman",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read())
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        logger.warning("GitHub /user lookup failed: %s", exc)
        return None
    return {
        "id": data.get("id"),
        "login": data.get("login"),
        "name": data.get("name"),
        "avatar_url": data.get("avatar_url"),
    }
