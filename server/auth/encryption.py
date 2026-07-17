"""Symmetric encryption for OAuth tokens at rest.

Fernet (AES-128-CBC + HMAC-SHA256) keyed from SESSION_ENCRYPTION_KEY. Only
auth/session.py should call this — access tokens must never be persisted,
logged, or returned to a caller in plaintext outside that boundary.
"""

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

import config

logger = logging.getLogger("migration_foreman.auth.encryption")

_DEV_FALLBACK_KEY = "insecure-dev-only-key-set-SESSION_ENCRYPTION_KEY-for-real-use"
_warned = False


def _fernet() -> Fernet:
    global _warned
    key = config.SESSION_ENCRYPTION_KEY
    if not key:
        if not _warned:
            logger.warning(
                "SESSION_ENCRYPTION_KEY is not set; falling back to an insecure "
                "dev-only key. Set SESSION_ENCRYPTION_KEY before storing real "
                "user OAuth tokens."
            )
            _warned = True
        key = _DEV_FALLBACK_KEY
    # Fernet needs a 32-byte urlsafe-base64 key; derive one from whatever
    # string-shaped secret is configured so any value can be used as a key.
    digest = hashlib.sha256(key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt(ciphertext: bytes) -> str:
    try:
        return _fernet().decrypt(bytes(ciphertext)).decode()
    except InvalidToken as exc:
        raise ValueError(
            "Stored token could not be decrypted (key mismatch or corruption)"
        ) from exc
