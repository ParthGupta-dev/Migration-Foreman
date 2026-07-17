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
import re
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


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# --- Python test-style detection (pytest vs unittest vs none) ------------
#
# Broader than a single requirements.txt/pyproject.toml check: dependency
# declarations are scanned across every common requirements-file naming
# convention (not just the exact name "requirements.txt"), and when no
# manifest settles it, the test files THEMSELVES are inspected. A file full
# of bare `def test_x(): assert ...` functions with no `unittest.TestCase`
# subclass can only ever be collected by pytest, no matter what any
# manifest says (or fails to say) -- `python -m unittest discover` will
# silently find zero tests and exit non-zero, a real but misleading
# failure that has nothing to do with the migration under test.

_PYTEST_MARKER_RE = re.compile(r"^\s*(?:import pytest\b|from pytest\b|@pytest\.)", re.MULTILINE)
_UNITTEST_CLASS_RE = re.compile(r"class\s+\w+\s*\(\s*(?:unittest\.)?TestCase\s*\)")
_BARE_TEST_FUNC_RE = re.compile(r"^\s*def\s+test_\w+\s*\(", re.MULTILINE)
_MAX_TEST_FILES_SAMPLED = 20


def requirement_files(root: Path) -> list[Path]:
    """Every requirements*.txt variant present, however dev/test deps are
    conventionally named (requirements.txt, requirements-dev.txt,
    dev-requirements.txt, requirements-test.txt, ...)."""
    found: dict[str, Path] = {}
    for pattern in ("requirements*.txt", "*-requirements.txt"):
        for path in root.glob(pattern):
            if path.is_file():
                found[path.name] = path
    return list(found.values())


def _declares_pytest(root: Path) -> bool:
    if any("pytest" in _read(path) for path in requirement_files(root)):
        return True
    for name in ("Pipfile", "poetry.lock", "pyproject.toml"):
        if "pytest" in _read(root / name):
            return True
    return False


def _python_test_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for name in ("tests", "test"):
        directory = root / name
        if directory.is_dir():
            files += list(directory.rglob("test*.py"))
            files += list(directory.rglob("*_test.py"))
    return files


def detect_python_test_style(root: Path) -> str | None:
    """'pytest' | 'unittest' | None (no Python tests found here).

    Priority: explicit pytest config (pytest.ini, conftest.py, a
    [tool.pytest]/[pytest] section) > the test files' own syntax (the most
    grounded signal -- it's what will actually be collected) > a declared
    pytest dependency > the safe stdlib-only unittest fallback.
    """
    if (root / "pytest.ini").is_file() or (root / "conftest.py").is_file():
        return "pytest"
    for name in ("pyproject.toml", "tox.ini", "setup.cfg"):
        text = _read(root / name)
        if "[tool.pytest" in text or "[pytest]" in text or "[tool:pytest]" in text:
            return "pytest"

    test_files = _python_test_files(root)
    if not test_files:
        return None

    sample = "".join(_read(path) for path in test_files[:_MAX_TEST_FILES_SAMPLED])
    if _PYTEST_MARKER_RE.search(sample):
        return "pytest"
    if _UNITTEST_CLASS_RE.search(sample):
        return "unittest"
    if _BARE_TEST_FUNC_RE.search(sample):
        # Bare test functions with no TestCase subclass: unittest discover
        # would collect none of these regardless of any manifest.
        return "pytest"
    return "pytest" if _declares_pytest(root) else "unittest"


def _python_test_command(root: Path, subdir: str | None = None) -> str | None:
    """The verification command for the Python tests found in `root`.

    `subdir` is `root`'s path relative to the actual execution root (the
    repository root) when scoping to one monorepo package -- the command
    always runs from the repository root, adding `subdir` to PYTHONPATH,
    rather than cd-ing into it: cd-ing away from the repo root drops any
    sibling top-level package off sys.path, breaking imports inside the
    subdir's own modules that reach across the repo (e.g.
    `backend/report_integrity.py` importing a shared `agent/` package next
    to `backend/`) -- a real, observed failure unrelated to the migration
    under test. `subdir=None` means `root` already IS the execution root.
    """
    style = detect_python_test_style(root)
    if style is None:
        return None
    test_dir = "tests" if (root / "tests").is_dir() else "test"

    if not subdir:
        if style == "pytest":
            return "python -m pytest -q"
        return f'python -m unittest discover -s "{test_dir}" -t . -v'

    env = f'PYTHONPATH=".:{subdir}"'
    if style == "pytest":
        return f"{env} python -m pytest {subdir} -q"
    return f'{env} python -m unittest discover -s "{subdir}/{test_dir}" -t "{subdir}" -v'


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
    has_python_manifest = any((root / name).is_file() for name in (
        "pyproject.toml", "setup.py", "setup.cfg", "poetry.lock", "tox.ini", "pytest.ini",
    )) or requirement_files(root)
    if has_python_manifest:
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


def infer_test_command(root: Path, *, subdir: str | None = None) -> str | None:
    """Infer a verification command for `root`. None = no confident match.

    `subdir` is `root`'s path relative to the actual execution root when
    `root` is one package inside a monorepo (see infer_test_command_for_files):
    JS/Makefile/other tooling still `cd`s into `subdir` (npm/pnpm/yarn/make
    resolve relative to their manifest's location), but Python instead runs
    from the repository root with `subdir` on PYTHONPATH (_python_test_command)
    -- cd-ing away from the repo root would otherwise drop any sibling
    top-level package off sys.path and break imports that reach across the
    repo, a real observed failure unrelated to the migration under test.

    Priority: repo-specific scripts (package.json scripts, Makefile test
    target) > framework/lockfile conventions > stdlib unittest fallback.
    """
    command = _infer_js(root)  # package.json scripts + lockfile-aware runner
    if command:
        return f'cd "{subdir}" && {command}' if subdir else command
    command = _makefile_test_target(root)
    if command:
        return f'cd "{subdir}" && {command}' if subdir else command
    # Python command construction already accounts for `subdir` itself.
    command = _python_test_command(root, subdir=subdir)
    if command:
        return command
    command = _infer_other_ecosystems(root)
    if command:
        return f'cd "{subdir}" && {command}' if subdir else command
    return None


def infer_test_command_for_files(repo_path: Path, files: list[str]) -> str | None:
    """Seam-scoped inference for monorepos.

    If every file the seam touches lives under one top-level directory that
    carries its own manifest, the command is inferred there and scoped to
    that directory. Otherwise: root inference if the root has a manifest;
    None (ask the human) when the seam spans multiple ecosystems with no
    root-level signal.
    """
    top_dirs = {file.split("/")[0] for file in files if "/" in file}
    root_has_manifest = bool(_ecosystem_manifests(repo_path))

    if len(top_dirs) == 1:
        subdir = next(iter(top_dirs))
        sub_path = repo_path / subdir
        if sub_path.is_dir() and _ecosystem_manifests(sub_path):
            command = infer_test_command(sub_path, subdir=subdir)
            if command:
                return command

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
        subdir = with_manifests[0]
        command = infer_test_command(repo_path / subdir, subdir=subdir)
        if command:
            return command
    return infer_test_command(repo_path)
