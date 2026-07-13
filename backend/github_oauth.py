"""GitHub OAuth web flow: "Connect GitHub" without pasting a token.

Flow (see the OAuth endpoints in main.py):

1. GET /github/oauth/start   — mints a CSRF `state`, remembers it against the
   browser session (mf_session cookie), 302s to github.com/login/oauth/authorize.
2. User authorizes on GitHub; GitHub redirects to GET /github/callback.
3. The callback validates `state`, exchanges the `code` for an access token,
   stores the token SERVER-SIDE keyed by the session cookie, and redirects
   back to the frontend. The raw token is never sent to the browser.

Storage is in-memory: tokens live for the backend process's lifetime, so a
backend restart means reconnecting. That is deliberate for now — no token
ever touches the database or the frontend. config.GITHUB_TOKEN (env) remains
the non-OAuth fallback for local dev, and the UI's manual-token field remains
the fallback when no OAuth app is configured.
"""

import json
import logging
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import config

logger = logging.getLogger("migration_foreman.github_oauth")

SESSION_COOKIE = "mf_session"
_STATE_TTL_SECONDS = 600  # authorize screens abandoned longer than this are dead

# state -> {"session": session_id, "next": frontend path, "expires": epoch}
_pending_states: dict[str, dict] = {}
# session_id -> {"token": access token, "username": github login or None}
_sessions: dict[str, dict] = {}


class OAuthError(Exception):
    """Code exchange or user lookup failed."""


def configured() -> bool:
    return bool(config.GITHUB_OAUTH_CLIENT_ID and config.GITHUB_OAUTH_CLIENT_SECRET)


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def begin(session_id: str, next_path: str) -> str:
    """Store a fresh CSRF state for this session; return the authorize URL."""
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
        "scope": "repo",
        "state": state,
    })
    return f"https://github.com/login/oauth/authorize?{params}"


def pop_state(state: str) -> dict | None:
    """Consume a pending state (one-shot). None = unknown/expired = reject."""
    _prune_states()
    return _pending_states.pop(state, None)


def _prune_states() -> None:
    now = time.time()
    for state in [s for s, v in _pending_states.items() if v["expires"] < now]:
        _pending_states.pop(state, None)


def exchange_code(code: str) -> str:
    """Trade the callback `code` for an access token at GitHub's token endpoint."""
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
            f"GitHub rejected the code exchange: {data.get('error_description') or data.get('error') or 'no access_token in response'}"
        )
    return token


def fetch_username(token: str) -> str | None:
    """Best-effort GET /user for the "Connected as <login>" UI polish."""
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
            return json.loads(response.read()).get("login")
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        logger.warning("GitHub /user lookup failed: %s", exc)
        return None


def store_token(session_id: str, token: str, username: str | None) -> None:
    _sessions[session_id] = {"token": token, "username": username}


def get_token(session_id: str | None) -> str | None:
    if not session_id:
        return None
    session = _sessions.get(session_id)
    return session["token"] if session else None


def get_username(session_id: str | None) -> str | None:
    if not session_id:
        return None
    session = _sessions.get(session_id)
    return session["username"] if session else None
