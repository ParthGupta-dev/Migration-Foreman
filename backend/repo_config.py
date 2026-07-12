"""Optional per-repo seam config: .migration-foreman.json at the repo root.

Candidates from the Discovery Engine carry scope + scores but not
before/after patterns or a test command — the contract's candidate shape has
no such fields. When the operator confirms a candidateId, the seam fields are
resolved in precedence order: request-body overrides > this file > inferred
defaults (testCommand only, via infer_test_command). The file is an advanced
override, not a prerequisite; repos without it work as long as the request
supplies before/after patterns.

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


def infer_test_command(repo_path: Path) -> str | None:
    """Best-effort test command for repos without a config file."""
    package_json = repo_path / "package.json"
    if package_json.is_file():
        try:
            pkg = json.loads(package_json.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pkg = {}
        if isinstance(pkg.get("scripts"), dict) and pkg["scripts"].get("test"):
            return "npm test --silent"

    pyproject = repo_path / "pyproject.toml"
    uses_pytest = (repo_path / "pytest.ini").is_file() or (repo_path / "conftest.py").is_file()
    if not uses_pytest and pyproject.is_file():
        try:
            uses_pytest = "[tool.pytest" in pyproject.read_text(encoding="utf-8")
        except OSError:
            pass
    if uses_pytest:
        return "python -m pytest -q"

    tests_dir = repo_path / "tests"
    if tests_dir.is_dir() and any(tests_dir.glob("test*.py")):
        return "python -m unittest discover -s tests -t . -v"
    return None
