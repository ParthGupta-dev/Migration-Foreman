"""Recent-commit-activity score per file (git log frequency, recency-weighted).

Each touch of a file contributes exp(-age / 30 days); per-file sums are
normalized so the most active file scores 1.0.
"""

import math
import time
from pathlib import Path

from shell import run_git

HALF_LIFE_DAYS = 30.0
MAX_COMMITS = 500


def recent_activity_scores(repo_path: Path) -> dict[str, float]:
    result = run_git(
        ["log", "--name-only", "--pretty=format:@%ct", f"-n{MAX_COMMITS}"],
        cwd=repo_path,
    )
    if not result.ok:
        return {}

    now = time.time()
    decay = math.log(2) / (HALF_LIFE_DAYS * 86400)
    raw: dict[str, float] = {}
    weight = 0.0
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("@"):
            try:
                age = max(0.0, now - float(line[1:]))
                weight = math.exp(-decay * age)
            except ValueError:
                weight = 0.0
        else:
            raw[line] = raw.get(line, 0.0) + weight

    if not raw:
        return {}
    peak = max(raw.values()) or 1.0
    return {path: score / peak for path, score in raw.items()}
