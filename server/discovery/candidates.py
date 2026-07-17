"""Candidate computation: centrality x recent activity, grouped into scopes.

Files are grouped by top-level directory; each group becomes one candidate
whose scopeGlobs target the group's dominant file extension (one seam =
one coherent migration surface). Scores are summed per group, then the
combined score is normalized so the top candidate is 1.0.

Candidates and the graph are cached in-memory per repoId — recomputed on
backend restart from the on-disk clone, which is acceptable for hackathon
scope (repos table survives; candidates are derived data).
"""

import hashlib
from pathlib import Path

import networkx as nx

from discovery import blacklist, graph as graph_mod, ranking

_CANDIDATE_CACHE: dict[str, list[dict]] = {}
_GRAPH_CACHE: dict[str, nx.DiGraph] = {}


def _candidate_id(repo_id: str, globs: list[str]) -> str:
    return hashlib.sha1(f"{repo_id}|{'|'.join(sorted(globs))}".encode()).hexdigest()[:12]


def compute_candidates(
    repo_id: str, repo_path: Path, extra_blacklist: list[str] | None = None
) -> list[dict]:
    dep_graph = graph_mod.build_graph(repo_path)
    _GRAPH_CACHE[repo_id] = dep_graph

    centrality = graph_mod.centrality_scores(dep_graph)
    activity = ranking.recent_activity_scores(repo_path)

    # Group files by top-level directory (root files form their own group).
    groups: dict[str, list[str]] = {}
    for rel_path in dep_graph.nodes:
        top = rel_path.split("/")[0] if "/" in rel_path else "."
        groups.setdefault(top, []).append(rel_path)

    candidates: list[dict] = []
    for top, files in sorted(groups.items()):
        # Dominant extension decides the glob so units stay one language.
        ext_counts: dict[str, int] = {}
        for file in files:
            ext = "." + file.rsplit(".", 1)[-1]
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
        dominant_ext = max(ext_counts, key=lambda ext: ext_counts[ext])

        globs = [f"*{dominant_ext}"] if top == "." else [f"{top}/**/*{dominant_ext}"]
        in_scope = [file for file in files if file.endswith(dominant_ext)]

        centrality_sum = sum(centrality.get(file, 0.0) for file in in_scope)
        activity_sum = sum(activity.get(file, 0.0) for file in in_scope)
        candidates.append(
            {
                "candidateId": _candidate_id(repo_id, globs),
                "scopeGlobs": globs,
                "centralityScore": round(centrality_sum, 4),
                "recentActivityScore": round(activity_sum, 4),
                "combinedScore": centrality_sum * activity_sum,
                "blacklisted": any(
                    blacklist.is_blacklisted(file, extra_blacklist) for file in in_scope
                ),
                "files": in_scope,
            }
        )

    peak = max((cand["combinedScore"] for cand in candidates), default=0.0) or 1.0
    for cand in candidates:
        cand["combinedScore"] = round(cand["combinedScore"] / peak, 4)
    candidates.sort(key=lambda cand: cand["combinedScore"], reverse=True)

    _CANDIDATE_CACHE[repo_id] = candidates
    return candidates


def get_candidates(repo_id: str, repo_path: Path) -> list[dict]:
    if repo_id not in _CANDIDATE_CACHE and repo_path.is_dir():
        compute_candidates(repo_id, repo_path)
    return _CANDIDATE_CACHE.get(repo_id, [])


def get_candidate(repo_id: str, repo_path: Path, candidate_id: str) -> dict | None:
    for cand in get_candidates(repo_id, repo_path):
        if cand["candidateId"] == candidate_id:
            return cand
    return None


def get_graph(repo_id: str, repo_path: Path) -> nx.DiGraph:
    if repo_id not in _GRAPH_CACHE and repo_path.is_dir():
        compute_candidates(repo_id, repo_path)
    return _GRAPH_CACHE.get(repo_id, nx.DiGraph())
