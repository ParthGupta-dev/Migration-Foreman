"""GitHub-authenticated session storage — Postgres-backed, tokens encrypted.

A session is keyed by an opaque random id carried in an HttpOnly cookie
(mf_session, set by main.py). auth/oauth.py handles the CSRF dance and code
exchange; this module owns what happens after: persisting the resulting
profile + token, validating/expiring sessions, and logout.

Access tokens are only ever decrypted inside get_access_token(), which is
meant to be called exclusively by services/github_service.py to build a
GithubClient. Every other reader gets the profile-only view from
get_session().
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

import config
import db
from auth import encryption

logger = logging.getLogger("migration_foreman.auth.session")


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


async def create_session(
    session_id: str,
    github_user: dict,
    access_token: str,
    refresh_token: str | None = None,
    token_expires_in: int | None = None,
) -> None:
    token_expires_at = (
        datetime.now(timezone.utc) + timedelta(seconds=token_expires_in)
        if token_expires_in else None
    )
    session_expires_at = datetime.now(timezone.utc) + timedelta(hours=config.SESSION_TTL_HOURS)
    await db.execute(
        """
        INSERT INTO github_sessions (
            session_id, github_user_id, username, display_name, avatar_url,
            access_token_encrypted, refresh_token_encrypted, token_expires_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (session_id) DO UPDATE SET
            github_user_id = EXCLUDED.github_user_id,
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            avatar_url = EXCLUDED.avatar_url,
            access_token_encrypted = EXCLUDED.access_token_encrypted,
            refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
            token_expires_at = EXCLUDED.token_expires_at,
            expires_at = EXCLUDED.expires_at,
            last_seen_at = now()
        """,
        session_id,
        github_user.get("id"),
        github_user.get("login"),
        github_user.get("name"),
        github_user.get("avatar_url"),
        encryption.encrypt(access_token),
        encryption.encrypt(refresh_token) if refresh_token else None,
        token_expires_at,
        session_expires_at,
    )
    logger.info(
        "GitHub session stored for %s (session %s...)",
        github_user.get("login"), session_id[:8],
    )


async def get_session(session_id: str | None) -> dict | None:
    """Public profile view of a session. Never includes the raw token."""
    if not session_id:
        return None
    row = await db.fetchrow("SELECT * FROM github_sessions WHERE session_id = $1", session_id)
    if row is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        await destroy_session(session_id)
        return None
    return {
        "githubId": row["github_user_id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "avatarUrl": row["avatar_url"],
        "expiresAt": row["expires_at"],
    }


async def get_access_token(session_id: str | None) -> str | None:
    """Decrypts and returns the stored access token, or None if absent/expired.

    Callers outside auth/* and services/github_service.py should not need
    this — use get_session() for anything profile-related.
    """
    if not session_id:
        return None
    row = await db.fetchrow("SELECT * FROM github_sessions WHERE session_id = $1", session_id)
    if row is None:
        return None
    if row["expires_at"] < datetime.now(timezone.utc):
        await destroy_session(session_id)
        return None
    return encryption.decrypt(row["access_token_encrypted"])


async def touch_session(session_id: str) -> None:
    """Sliding-window refresh: extend session expiry on active use."""
    await db.execute(
        "UPDATE github_sessions SET expires_at = $2, last_seen_at = now() WHERE session_id = $1",
        session_id,
        datetime.now(timezone.utc) + timedelta(hours=config.SESSION_TTL_HOURS),
    )


async def destroy_session(session_id: str) -> None:
    await db.execute("DELETE FROM github_sessions WHERE session_id = $1", session_id)
