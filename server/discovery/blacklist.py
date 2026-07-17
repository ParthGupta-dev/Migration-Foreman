"""Safety blacklist per PROJECT.md: auth/, payments/, migrations/, secrets.

Applied before candidates are shown; blacklisted candidates are returned with
blacklisted=true for transparency but can never be selected (the seam
endpoint rejects them, so Autonomous mode cannot silently override).

Configurable per repo: a "blacklist" array of glob patterns in
.migration-foreman.json extends the defaults.
"""

import fnmatch

DEFAULT_BLACKLIST = [
    "auth/*",
    "*/auth/*",
    "payments/*",
    "*/payments/*",
    "migrations/*",
    "*/migrations/*",
    "*.env*",
    "*secret*",
    "*credential*",
]


def is_blacklisted(rel_path: str, extra_patterns: list[str] | None = None) -> bool:
    patterns = DEFAULT_BLACKLIST + (extra_patterns or [])
    # fnmatch's * crosses "/" so directory patterns match at any depth
    return any(fnmatch.fnmatch(rel_path, pattern) for pattern in patterns)
