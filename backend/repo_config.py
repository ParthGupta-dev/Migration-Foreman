"""Optional per-repo seam config: .migration-foreman.json at the repo root.

Candidates from the Discovery Engine carry scope + scores but not
before/after patterns or a test command — the contract's candidate shape has
no such fields. When the operator confirms a candidateId, the seam's
beforePattern/afterPattern/invariants/testCommand are read from this file.
Repos without it must use manualSeam (the API returns 400 seam_config_missing).

Shape:
{
  "beforePattern": "legacy_format",
  "afterPattern": "format_text",
  "invariants": ["all existing tests pass"],
  "testCommand": "python -m unittest discover -s tests -t . -v"
}
"""

import json
from pathlib import Path

import config


def load_repo_config(repo_path: Path) -> dict | None:
    path = repo_path / config.REPO_CONFIG_FILENAME
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    required = ("beforePattern", "afterPattern", "testCommand")
    if not all(isinstance(data.get(key), str) and data[key] for key in required):
        return None
    invariants = data.get("invariants", [])
    if not isinstance(invariants, list):
        invariants = []
    return {
        "beforePattern": data["beforePattern"],
        "afterPattern": data["afterPattern"],
        "invariants": [str(item) for item in invariants],
        "testCommand": data["testCommand"],
    }
