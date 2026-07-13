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


# --- Verification command inference ------------------------------------
#
# Conservative by design: an inferred command is a pre-filled suggestion the
# user always sees and can edit; "no confident match" (None) is a legal and
# safe outcome — never guess. Commands run inside sandboxed worktrees with
# the backend's environment and NO dependency-install step, so inference
# prefers infra-free invocations and never selects anything that hangs
# (watch modes) or needs infrastructure (e2e).
#
# Explicitly out of scope: parsing CI YAML to extract the test step —
# detecting CI config is trivial, extracting the right job is not; a repo
# where CI is the only signal counts as "no confident match".

# package.json script preference order; anything else is not auto-selected.
_NPM_SCRIPT_PREFERENCE = ("test", "test:unit", "test:ci")
_NPM_SCRIPT_BANNED = ("watch", "e2e", "dev")


def _npm_runner(root: Path) -> str:
    """Pick the JS package runner from the lockfile present."""
    if (root / "pnpm-lock.yaml").is_file():
        return "pnpm"
    if (root / "yarn.lock").is_file():
        return "yarn"
    return "npm"


def _infer_js(root: Path) -> str | None:
    package_json = root / "package.json"
    if not package_json.is_file():
        return None
    try:
        pkg = json.loads(package_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    scripts = pkg.get("scripts")
    if not isinstance(scripts, dict):
        return None

    def usable(name: str) -> bool:
        return name in scripts and not any(bad in name for bad in _NPM_SCRIPT_BANNED)

    chosen = next((name for name in _NPM_SCRIPT_PREFERENCE if usable(name)), None)
    if chosen is None:
        # test:unit:* family — first match in script order, banned words excluded.
        chosen = next(
            (name for name in scripts if name.startswith("test:unit:") and usable(name)),
            None,
        )
    if chosen is None:
        return None  # other test-ish scripts exist? Ambiguous -> no confident match.

    runner = _npm_runner(root)
    if chosen == "test":
        return f"{runner} test" + (" --silent" if runner == "npm" else "")
    return f"{runner} run {chosen}" + (" --silent" if runner == "npm" else "")


def _has_python_tests(root: Path) -> bool:
    for name in ("tests", "test"):
        directory = root / name
        if directory.is_dir() and any(directory.rglob("test*.py")):
            return True
    return (root / "conftest.py").is_file()


def _uses_pytest(root: Path) -> bool:
    if (root / "pytest.ini").is_file() or (root / "conftest.py").is_file():
        return True
    pyproject = root / "pyproject.toml"
    if pyproject.is_file():
        try:
            content = pyproject.read_text(encoding="utf-8")
        except OSError:
            return False
        return "[tool.pytest" in content or '"pytest"' in content or "'pytest'" in content
    return False


def _infer_python(root: Path) -> str | None:
    # pytest beats python -m pytest beats bare tox (tox spins up environments
    # the worktree can't support); tox.ini only counts as a pytest signal.
    python_signals = any(
        (root / name).is_file()
        for name in ("pyproject.toml", "poetry.lock", "requirements.txt",
                     "setup.py", "setup.cfg", "tox.ini")
    )
    if (python_signals or _has_python_tests(root)) and _uses_pytest(root):
        return "python -m pytest -q"
    # Safe stdlib fallback: needs zero installed dependencies.
    tests_dir = root / "tests"
    if tests_dir.is_dir() and any(tests_dir.glob("test*.py")):
        return "python -m unittest discover -s tests -t . -v"
    return None


def _makefile_test_target(root: Path) -> str | None:
    makefile = root / "Makefile"
    if not makefile.is_file():
        return None
    try:
        lines = makefile.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    if any(line.startswith("test:") for line in lines):
        return "make test"
    return None


def _infer_other_ecosystems(root: Path) -> str | None:
    if (root / "Cargo.toml").is_file():
        return "cargo test"
    if (root / "go.mod").is_file():
        return "go test ./..."
    if (root / "pom.xml").is_file():
        return "mvn -q test"
    if (root / "build.gradle").is_file() or (root / "build.gradle.kts").is_file():
        return "./gradlew test" if (root / "gradlew").is_file() else "gradle test"
    if any(root.glob("*.sln")) or any(root.glob("*.csproj")):
        return "dotnet test"
    return None


def _ecosystem_manifests(root: Path) -> list[str]:
    """Which ecosystems leave a manifest at this directory level."""
    found = []
    if (root / "package.json").is_file():
        found.append("js")
    if any((root / name).is_file() for name in (
        "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg",
        "poetry.lock", "tox.ini", "pytest.ini",
    )):
        found.append("python")
    for marker, name in (
        ("Cargo.toml", "rust"), ("go.mod", "go"), ("pom.xml", "maven"),
        ("build.gradle", "gradle"),
    ):
        if (root / marker).is_file():
            found.append(name)
    if any(root.glob("*.sln")) or any(root.glob("*.csproj")):
        found.append("dotnet")
    return found


def infer_test_command(root: Path) -> str | None:
    """Infer a verification command for one directory. None = no confident match.

    Priority: repo-specific scripts (package.json scripts, Makefile test
    target) > framework/lockfile conventions > stdlib unittest fallback.
    """
    # 1. Repository-specific scripts.
    command = _infer_js(root)  # package.json scripts + lockfile-aware runner
    if command:
        return command
    command = _makefile_test_target(root)
    if command:
        return command
    # 2. Framework/lockfile conventions. 3. Safe stdlib fallback (inside
    # _infer_python). Multiple ecosystems at one level with no clear script
    # would be ambiguous — but each helper is independently confident, so
    # first hit wins in a fixed order.
    return _infer_python(root) or _infer_other_ecosystems(root)


def infer_test_command_for_files(repo_path: Path, files: list[str]) -> str | None:
    """Seam-scoped inference for monorepos.

    If every file the seam touches lives under one top-level directory that
    carries its own manifest, the command is inferred there and scoped with a
    `cd`. Otherwise: root inference if the root has a manifest; None (ask the
    human) when the seam spans multiple ecosystems with no root-level signal.
    """
    top_dirs = {file.split("/")[0] for file in files if "/" in file}
    root_has_manifest = bool(_ecosystem_manifests(repo_path))

    if len(top_dirs) == 1:
        subdir = next(iter(top_dirs))
        sub_path = repo_path / subdir
        if sub_path.is_dir() and _ecosystem_manifests(sub_path):
            command = infer_test_command(sub_path)
            if command:
                return f'cd "{subdir}" && {command}'

    if root_has_manifest or not top_dirs:
        return infer_test_command(repo_path)

    # Seam spans several top-level dirs and the root carries no manifest:
    # one repo-wide command would be a guess. Check if exactly one touched
    # dir has a manifest; otherwise defer to the human.
    with_manifests = [
        directory for directory in sorted(top_dirs)
        if (repo_path / directory).is_dir() and _ecosystem_manifests(repo_path / directory)
    ]
    if len(with_manifests) == 1:
        command = infer_test_command(repo_path / with_manifests[0])
        if command:
            return f'cd "{with_manifests[0]}" && {command}'
    return infer_test_command(repo_path)
