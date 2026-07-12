// Minimal glob matcher for highlighting nodes against a seam's scopeGlobs
// (patterns like "sdk/**/*.py" or "src/*.ts"). Mirrors the backend's
// fnmatch-based approach (splitter.py): "**/" is collapsed away first (so
// it doesn't force an extra path segment — "src/**/*.py" must match
// "src/foo.py", not just "src/sub/foo.py"), then every remaining run of
// "*" becomes ".*", crossing "/" the same way Python's fnmatch does.

function globToRegExp(glob: string): RegExp {
  const collapsed = glob.split("**/").join("*");
  const escaped = collapsed
    .split(/\*+/)
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

export function matchesAnyGlob(path: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
