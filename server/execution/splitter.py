"""Rule-based unit split: one unit per file matched by the seam's scope globs.

Uses the scannable set (code + docs/markup/styles) so migrations can also
touch READMEs, HTML, and CSS — each still one isolated unit.
"""

import fnmatch
from pathlib import Path

from discovery import parser


def split_units(repo_path: Path, scope_globs: list[str]) -> list[str]:
    """Return repo-relative file paths, one per unit, matching any scope glob."""
    files = [
        file.relative_to(repo_path).as_posix()
        for file in parser.list_scannable_files(repo_path)
    ]
    matched: list[str] = []
    for rel_path in files:
        for glob in scope_globs:
            # fnmatch treats "**" and "*" identically (both cross "/"),
            # which matches how the candidate globs are generated.
            if fnmatch.fnmatch(rel_path, glob.replace("**/", "*")) or fnmatch.fnmatch(
                rel_path, glob
            ):
                matched.append(rel_path)
                break
    return matched
