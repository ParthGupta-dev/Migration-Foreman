"""Import extraction for the dependency graph.

NOTE (flagged deviation): PROJECT.md names Tree-sitter for parsing. Compiled
Tree-sitter grammars per language are impractical to bundle for the
hackathon, so this module extracts imports with per-language regexes as a
documented stand-in. tree-sitter stays in requirements.txt so a grammar-based
parser can drop in behind the same extract_imports() signature.
"""

import re
from pathlib import Path

SUPPORTED_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}

# Migration units and planner grounding also cover non-code assets (docs,
# markup, styles) — the dependency graph itself stays code-only.
SCANNABLE_EXTENSIONS = SUPPORTED_EXTENSIONS | {".md", ".markdown", ".html", ".htm", ".css"}

SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".next",
    "venv",
    ".venv",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
}

_PY_IMPORT = re.compile(r"^\s*import\s+([\w\.]+)", re.MULTILINE)
_PY_FROM = re.compile(r"^\s*from\s+([\w\.]+)\s+import\s+", re.MULTILINE)
_JS_IMPORT = re.compile(r"""(?:import\s+(?:[\w{},*\s]+\s+from\s+)?|export\s+[\w{},*\s]+\s+from\s+)['"]([^'"]+)['"]""")
_JS_REQUIRE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")


def list_source_files(repo_path: Path) -> list[Path]:
    return _list_files(repo_path, SUPPORTED_EXTENSIONS)


def list_scannable_files(repo_path: Path) -> list[Path]:
    return _list_files(repo_path, SCANNABLE_EXTENSIONS)


def _list_files(repo_path: Path, extensions: set[str]) -> list[Path]:
    files: list[Path] = []
    for path in sorted(repo_path.rglob("*")):
        if not path.is_file() or path.suffix not in extensions:
            continue
        rel_parts = path.relative_to(repo_path).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        files.append(path)
    return files


def extract_imports(path: Path) -> list[str]:
    """Return raw import specifiers found in one source file."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    if path.suffix == ".py":
        return _PY_IMPORT.findall(text) + _PY_FROM.findall(text)
    return _JS_IMPORT.findall(text) + _JS_REQUIRE.findall(text)


def resolve_import(spec: str, importer_rel: str, known_files: set[str]) -> str | None:
    """Map an import specifier to a repo-relative file path, if it is local.

    Python: dotted module paths tried as <mod>.py and <mod>/__init__.py, both
    absolute-from-root and relative to the importer's directory.
    JS/TS: only relative specifiers (./, ../) resolved, with extension probing.
    Third-party imports return None (they are not graph edges).
    """
    importer_dir = "/".join(importer_rel.split("/")[:-1])

    if not spec.startswith("."):
        # Python dotted path or bare JS specifier
        as_path = spec.replace(".", "/")
        candidates = [f"{as_path}.py", f"{as_path}/__init__.py"]
        if importer_dir:
            candidates += [f"{importer_dir}/{as_path}.py", f"{importer_dir}/{as_path}/__init__.py"]
        for candidate in candidates:
            if candidate in known_files:
                return candidate
        return None

    # Relative JS/TS specifier
    base_parts = importer_dir.split("/") if importer_dir else []
    for part in spec.split("/"):
        if part == "..":
            if base_parts:
                base_parts.pop()
        elif part not in (".", ""):
            base_parts.append(part)
    base = "/".join(base_parts)
    probes = [base] + [f"{base}{ext}" for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")]
    probes += [f"{base}/index{ext}" for ext in (".ts", ".tsx", ".js", ".jsx")]
    for probe in probes:
        if probe in known_files:
            return probe
    return None
