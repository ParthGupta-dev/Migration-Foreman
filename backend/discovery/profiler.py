"""Repository Profile: the zero-config bootstrap that makes a first-time
repository (no .migration-foreman anything) a first-class citizen.

Ingestion never requires migration-specific files to exist. Instead:

1. detect_metadata() checks whether this clone already carries any Migration
   Foreman state (the legacy single-file .migration-foreman.json override,
   or a .migration-foreman/ directory from a previous successful campaign
   against this same clone).
2. get_or_build_profile() loads the cached profile if step 1 found one,
   otherwise infers a fresh profile purely from what's on disk: languages,
   frameworks, package manager, build system, test framework, source roots,
   important directories, entry points, dependency manifests, CI config,
   and Docker config. This inferred profile is the initial project state —
   discovery and planning read it, nothing blocks on it being absent.
3. save_profile() / record_campaign_history() persist that state to
   .migration-foreman/ but ONLY as an optional cache, and ONLY called after
   a campaign actually completes (execution/engine.py). Delete the
   directory and the next ingestion just rebuilds it from scratch — never
   an error, never a "not initialized" state.
"""

import json
import logging
import time
from pathlib import Path

import config
from discovery import parser

logger = logging.getLogger("migration_foreman.profiler")

PROFILE_DIR_NAME = ".migration-foreman"
_PROFILE_FILENAME = "profile.json"
_CAMPAIGNS_DIRNAME = "campaigns"

# In-memory cache keyed by repoId, mirroring discovery.candidates' pattern —
# recomputed from the on-disk clone if the backend restarts.
_PROFILE_CACHE: dict[str, dict] = {}

_SOURCE_ROOT_NAMES = {
    "src", "lib", "app", "apps", "pkg", "cmd", "internal", "server", "client",
    "api", "core",
}
_IMPORTANT_DIR_NAMES = _SOURCE_ROOT_NAMES | {
    "tests", "test", "docs", "scripts", "config", "migrations", "public",
    "static", "components",
}

_ENTRY_POINT_CANDIDATES = [
    "main.py", "app.py", "manage.py", "wsgi.py", "asgi.py",
    "index.js", "index.ts", "server.js", "server.ts", "app.js", "app.ts",
    "src/index.js", "src/index.ts", "src/main.ts", "src/main.tsx",
    "main.go", "src/main.rs", "Program.cs",
]

_DOCKER_MARKERS = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"]

# dependency name -> framework label, searched as a substring of the
# relevant manifest's raw text (good enough for a heuristic, no need to
# actually parse every manifest format precisely).
_JS_FRAMEWORKS = {
    "next": "Next.js", "react": "React", "vue": "Vue", "@angular/core": "Angular",
    "svelte": "Svelte", "@nestjs/core": "NestJS", "express": "Express",
    "fastify": "Fastify", "koa": "Koa",
}
_PY_FRAMEWORKS = {
    "django": "Django", "flask": "Flask", "fastapi": "FastAPI", "pyramid": "Pyramid",
}
_GO_FRAMEWORKS = {"gin-gonic/gin": "Gin", "labstack/echo": "Echo"}
_JVM_FRAMEWORKS = {"spring-boot": "Spring Boot", "spring-core": "Spring"}
_DOTNET_FRAMEWORKS = {"Microsoft.AspNetCore": "ASP.NET Core"}


def profile_dir(repo_path: Path) -> Path:
    return repo_path / PROFILE_DIR_NAME


def detect_metadata(repo_path: Path) -> dict:
    """What Migration Foreman state (if any) already exists in this clone."""
    pdir = profile_dir(repo_path)
    return {
        "migrationConfig": (repo_path / config.REPO_CONFIG_FILENAME).is_file(),
        "cachedProfile": (pdir / _PROFILE_FILENAME).is_file(),
        "campaignHistory": (pdir / _CAMPAIGNS_DIRNAME).is_dir()
        and any((pdir / _CAMPAIGNS_DIRNAME).glob("*.json")),
    }


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _manifests_present(root: Path) -> list[str]:
    names = [
        "package.json", "requirements.txt", "pyproject.toml", "poetry.lock",
        "Pipfile.lock", "setup.py", "setup.cfg", "Cargo.toml", "go.mod",
        "pom.xml", "build.gradle", "build.gradle.kts",
    ]
    found = [name for name in names if (root / name).is_file()]
    found += [p.name for p in root.glob("*.csproj")]
    found += [p.name for p in root.glob("*.sln")]
    return found


def _package_manager(root: Path, manifests: list[str]) -> str | None:
    if "package.json" in manifests:
        if (root / "pnpm-lock.yaml").is_file():
            return "pnpm"
        if (root / "yarn.lock").is_file():
            return "yarn"
        return "npm"
    if "poetry.lock" in manifests:
        return "poetry"
    if "Pipfile.lock" in manifests:
        return "pipenv"
    if any(m in manifests for m in ("requirements.txt", "pyproject.toml", "setup.py", "setup.cfg")):
        return "pip"
    if "Cargo.toml" in manifests:
        return "cargo"
    if "go.mod" in manifests:
        return "go modules"
    if "pom.xml" in manifests:
        return "maven"
    if "build.gradle" in manifests or "build.gradle.kts" in manifests:
        return "gradle"
    if any(m.endswith((".csproj", ".sln")) for m in manifests):
        return "nuget"
    return None


def _build_system(root: Path, package_manager: str | None) -> str | None:
    if (root / "webpack.config.js").is_file():
        return "webpack"
    if any(root.glob("vite.config.*")):
        return "vite"
    if any(root.glob("rollup.config.*")):
        return "rollup"
    if (root / "Makefile").is_file():
        return "make"
    if (root / "CMakeLists.txt").is_file():
        return "cmake"
    if package_manager in ("pip", "poetry", "pipenv"):
        return "poetry build" if package_manager == "poetry" else "setuptools"
    if package_manager == "cargo":
        return "cargo build"
    if package_manager == "go modules":
        return "go build"
    if package_manager == "maven":
        return "maven"
    if package_manager == "gradle":
        return "gradle"
    if package_manager == "nuget":
        return "msbuild"
    if package_manager in ("npm", "pnpm", "yarn"):
        return package_manager
    return None


def _test_framework(root: Path, manifests: list[str]) -> str | None:
    if "package.json" in manifests:
        pkg_text = _read(root / "package.json")
        for name in ("vitest", "jest", "mocha", "jasmine", "ava"):
            if f'"{name}"' in pkg_text:
                return name
        if '"test"' in pkg_text:
            return "npm test script"
    if any(m in manifests for m in ("pyproject.toml", "poetry.lock", "requirements.txt", "setup.py", "setup.cfg", "tox.ini")) or (root / "pytest.ini").is_file():
        pyproject = _read(root / "pyproject.toml")
        req = _read(root / "requirements.txt")
        if (root / "pytest.ini").is_file() or "pytest" in pyproject or "pytest" in req:
            return "pytest"
    if (root / "tests").is_dir() or (root / "test").is_dir():
        return "unittest"
    if "Cargo.toml" in manifests:
        return "cargo test"
    if "go.mod" in manifests:
        return "go test"
    if "pom.xml" in manifests or "build.gradle" in manifests:
        return "JUnit"
    if any(m.endswith(".csproj") for m in manifests):
        return "dotnet test"
    return None


def _frameworks(root: Path, manifests: list[str]) -> list[str]:
    found: list[str] = []
    if "package.json" in manifests:
        text = _read(root / "package.json")
        found += [label for dep, label in _JS_FRAMEWORKS.items() if f'"{dep}"' in text]
    if any(m in manifests for m in ("requirements.txt", "pyproject.toml", "Pipfile.lock")):
        text = _read(root / "requirements.txt") + _read(root / "pyproject.toml")
        found += [label for dep, label in _PY_FRAMEWORKS.items() if dep in text.lower()]
    if "go.mod" in manifests:
        text = _read(root / "go.mod")
        found += [label for dep, label in _GO_FRAMEWORKS.items() if dep in text]
    if "pom.xml" in manifests or "build.gradle" in manifests:
        text = _read(root / "pom.xml") + _read(root / "build.gradle") + _read(root / "build.gradle.kts")
        found += [label for dep, label in _JVM_FRAMEWORKS.items() if dep in text]
    for csproj in root.glob("*.csproj"):
        text = _read(csproj)
        found += [label for dep, label in _DOTNET_FRAMEWORKS.items() if dep in text]
    # Order-stable de-dup.
    return list(dict.fromkeys(found))


def _entry_points(root: Path) -> list[str]:
    found = [rel for rel in _ENTRY_POINT_CANDIDATES if (root / rel).is_file()]
    found += [
        p.relative_to(root).as_posix()
        for p in root.glob("cmd/*/main.go")
    ]
    return found


def _ci_config(root: Path) -> list[str]:
    found = []
    workflows = root / ".github" / "workflows"
    if workflows.is_dir() and (any(workflows.glob("*.yml")) or any(workflows.glob("*.yaml"))):
        found.append("GitHub Actions")
    if (root / ".gitlab-ci.yml").is_file():
        found.append("GitLab CI")
    if (root / ".circleci" / "config.yml").is_file():
        found.append("CircleCI")
    if (root / "Jenkinsfile").is_file():
        found.append("Jenkins")
    if (root / "azure-pipelines.yml").is_file():
        found.append("Azure Pipelines")
    if (root / ".travis.yml").is_file():
        found.append("Travis CI")
    return found


def _docker_config(root: Path) -> list[str]:
    return [name for name in _DOCKER_MARKERS if (root / name).is_file()]


def _structure(root: Path) -> tuple[list[str], list[str]]:
    """(sourceRoots, importantDirectories) from the top-level directory names."""
    try:
        top_dirs = [
            p.name for p in root.iterdir()
            if p.is_dir() and p.name not in parser.SKIP_DIRS and not p.name.startswith(".")
        ]
    except OSError:
        top_dirs = []
    source_roots = sorted(name for name in top_dirs if name in _SOURCE_ROOT_NAMES)
    important = sorted(name for name in top_dirs if name in _IMPORTANT_DIR_NAMES)
    return source_roots, important


def build_profile(repo_path: Path) -> dict:
    """Infer a full project profile from whatever is on disk — no Migration
    Foreman file of any kind is required for this to work."""
    scannable = parser.list_scannable_files(repo_path)
    languages: dict[str, int] = {}
    for file in scannable:
        ext = file.suffix.lstrip(".") or "(none)"
        languages[ext] = languages.get(ext, 0) + 1
    languages = dict(sorted(languages.items(), key=lambda kv: -kv[1]))

    manifests = _manifests_present(repo_path)
    package_manager = _package_manager(repo_path, manifests)
    source_roots, important_dirs = _structure(repo_path)

    return {
        "languages": languages,
        "frameworks": _frameworks(repo_path, manifests),
        "packageManager": package_manager,
        "buildSystem": _build_system(repo_path, package_manager),
        "testFramework": _test_framework(repo_path, manifests),
        "sourceRoots": source_roots,
        "importantDirectories": important_dirs,
        "entryPoints": _entry_points(repo_path),
        "dependencyManifests": manifests,
        "ciConfig": _ci_config(repo_path),
        "dockerConfig": _docker_config(repo_path),
        "generatedAt": time.time(),
    }


def get_or_build_profile(repo_id: str, repo_path: Path) -> tuple[dict, bool]:
    """Returns (profile, fromCache). Cache order: in-memory (this process) >
    .migration-foreman/profile.json on disk (survives a backend restart) >
    freshly inferred (first time this clone has ever been seen)."""
    if repo_id in _PROFILE_CACHE:
        return _PROFILE_CACHE[repo_id], True

    cached_path = profile_dir(repo_path) / _PROFILE_FILENAME
    if cached_path.is_file():
        try:
            profile = json.loads(cached_path.read_text(encoding="utf-8"))
            _PROFILE_CACHE[repo_id] = profile
            return profile, True
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Cached profile at %s unreadable, rebuilding: %s", cached_path, exc)

    profile = build_profile(repo_path)
    _PROFILE_CACHE[repo_id] = profile
    return profile, False


def save_profile(repo_path: Path, profile: dict) -> None:
    """Best-effort cache write. Never raises — a failure here must never
    affect campaign completion or any user-visible result."""
    try:
        pdir = profile_dir(repo_path)
        pdir.mkdir(parents=True, exist_ok=True)
        (pdir / _PROFILE_FILENAME).write_text(json.dumps(profile, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not write profile cache to %s: %s", repo_path, exc)


def record_campaign_history(repo_path: Path, campaign_id: str, entry: dict) -> None:
    """Best-effort campaign-history append. Never raises."""
    try:
        campaigns_dir = profile_dir(repo_path) / _CAMPAIGNS_DIRNAME
        campaigns_dir.mkdir(parents=True, exist_ok=True)
        (campaigns_dir / f"{campaign_id[:8]}.json").write_text(
            json.dumps(entry, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        logger.warning("Could not write campaign history for %s: %s", campaign_id, exc)
