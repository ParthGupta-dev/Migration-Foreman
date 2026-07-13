"""AI Seam Discovery: high-level objective -> approved-ready candidate seams.

Evolves the planning layer from "one intent, one seam" (planner.py) to
"one objective, many candidate seams". The flow is:

1. Repository analysis (read-only): file census, language breakdown,
   dependency-graph stats, most-depended-on files. Nothing is modified.
2. The LLM receives the objective plus the analysis and proposes 1-6
   candidate seams, each with patterns, scope, risk, dependencies and
   reasoning.
3. Every proposed seam is grounded against the actual clone via the same
   validation the single-seam planner uses (planner._validate): a seam whose
   beforePattern matches nothing is dropped, scope globs that miss every
   occurrence are repaired.

The result is advisory and stateless. Nothing executes from here: the client
presents the seams for human approval and submits each approved one through
the existing POST /repo/{id}/seam -> POST /campaign pipeline, so the
execution engine is untouched.

MOCK_CODEX=1: discovery degrades to the single-seam mock planner so the
whole flow runs offline.
"""

import logging
import math
from collections import Counter
from pathlib import Path

import config
import llm
from discovery import graph as depgraph
from discovery import parser
from planning import planner

logger = logging.getLogger("migration_foreman.seam_discovery")

_MAX_TREE_FILES = 300
_MAX_SEAMS = 6
# Rough per-file execution budget (attempt + verification) for the estimate.
_MINUTES_PER_FILE = 0.75

_RISK_ORDER = {"low": 0, "medium": 1, "high": 2}

_PROMPT_TEMPLATE = """You are a migration architect. Given a high-level engineering objective,
decompose it into a small set of safe, well-scoped, mechanical migration
seams for this repository. The engineer will review and approve each seam
before anything executes, so precision beats ambition.

Engineering objective: {objective}

Repository analysis:
{analysis}

Repository source files:
{tree}

Rules for every seam:
- beforePattern must be a Python regex (or literal string) that occurs in the
  CURRENT code shown above — it identifies what that seam migrates away from.
- afterPattern is the replacement that seam moves to.
- scopeGlobs select the files the seam migrates (e.g. "src/**/*.py").
- risk is your judgment of how likely the seam is to break behavior.
- confidence is your 0.0-1.0 estimate that the seam captures its slice of
  the objective.
- dependsOn lists the 0-based indexes of seams that must execute first
  (empty list if independent).
- reasoning must explain WHY this seam exists: why this slice is separable,
  why these patterns capture it, and what breakage you expect.
- Prefer 2-5 focused seams over one giant seam, but never invent seams the
  code does not support. If the objective is genuinely one mechanical
  change, return a single seam.

Return ONLY strict JSON, no markdown fences, exactly this shape:
{{"seams": [
  {{"title": "Short Title Like 'Replace JWT library'",
    "description": "one or two sentences on what this seam changes",
    "beforePattern": "...", "afterPattern": "...", "scopeGlobs": ["..."],
    "invariants": ["..."], "testCommand": "..." or null,
    "risk": "low" | "medium" | "high", "breakingChanges": true or false,
    "confidence": 0.0, "dependsOn": [0],
    "reasoning": "two to four sentences"}}
]}}
"""


class DiscoveryError(Exception):
    """The model failed to produce any usable seam for the objective."""


def analyze_repository(repo_path: Path) -> dict:
    """Read-only repository analysis fed to the model and the frontend."""
    scannable = parser.list_scannable_files(repo_path)
    rel_paths = [file.relative_to(repo_path).as_posix() for file in scannable]

    languages = Counter(file.suffix.lstrip(".") for file in scannable)
    top_dirs = Counter(
        rel.split("/")[0] for rel in rel_paths if "/" in rel
    )

    graph = depgraph.build_graph(repo_path)
    in_degrees = sorted(graph.in_degree(), key=lambda item: -item[1])
    central_files = [node for node, degree in in_degrees[:5] if degree > 0]

    return {
        "fileCount": len(scannable),
        "sourceFileCount": len(parser.list_source_files(repo_path)),
        "languages": dict(languages.most_common()),
        "topDirectories": [name for name, _ in top_dirs.most_common(8)],
        "graphNodes": graph.number_of_nodes(),
        "graphEdges": graph.number_of_edges(),
        "mostDependedOnFiles": central_files,
    }


def discover_seams(repo_path: Path, objective: str) -> dict:
    """Analyze the repo, propose candidate seams, ground each one.

    Returns the full discovery payload: repoSummary, grounded seams in
    dependency-respecting execution order, dropped seams with reasons, and
    campaign-level rollups (overall risk, file totals, time estimate).
    """
    summary = analyze_repository(repo_path)
    proposals = _generate(repo_path, objective, summary)

    seams: list[dict] = []
    dropped: list[dict] = []
    for index, proposal in enumerate(proposals):
        title = str(proposal.get("title") or "").strip() or f"Seam {index + 1}"
        try:
            grounded = planner._validate(repo_path, proposal)
        except planner.PlanValidationError as exc:
            logger.info("Discovery dropped seam %r: %s", title, exc)
            dropped.append({"title": title, "reason": str(exc)})
            continue
        seams.append({
            "seamId": f"seam-{index}",
            "title": title,
            "description": str(proposal.get("description") or "").strip(),
            "dependsOn": _clean_depends_on(proposal.get("dependsOn"), len(proposals), index),
            "beforePattern": grounded["beforePattern"],
            "afterPattern": grounded["afterPattern"],
            "scopeGlobs": grounded["scopeGlobs"],
            "invariants": grounded["invariants"],
            "testCommand": grounded["testCommand"],
            "risk": grounded["risk"],
            "breakingChanges": grounded["breakingChanges"],
            "confidence": grounded["confidence"],
            "reasoning": grounded["reasoning"],
            "groundedFiles": grounded["groundedFiles"],
            "estimatedFiles": len(grounded["groundedFiles"]),
            "occurrences": grounded["matchedOccurrences"],
            "repairedScope": grounded["repairedScope"],
        })

    if not seams:
        reasons = "; ".join(item["reason"] for item in dropped) or "no seams proposed"
        raise DiscoveryError(
            f"No proposed seam survived grounding against the repository ({reasons})"
        )

    seams = _execution_order(seams)
    total_files = len({rel for seam in seams for rel in seam["groundedFiles"]})
    overall_risk = max(
        (seam["risk"] for seam in seams), key=lambda risk: _RISK_ORDER.get(risk, 1)
    )

    return {
        "objective": objective,
        "repoSummary": summary,
        "seams": seams,
        "droppedSeams": dropped,
        "seamCount": len(seams),
        "totalEstimatedFiles": total_files,
        "overallRisk": overall_risk,
        "estimatedMinutes": max(1, math.ceil(total_files * _MINUTES_PER_FILE)),
    }


def _generate(repo_path: Path, objective: str, summary: dict) -> list[dict]:
    if config.MOCK_CODEX:
        # Offline path: the single-seam mock planner becomes a one-seam
        # discovery so the approval flow still exercises end to end.
        try:
            proposal = planner._mock_plan(objective)
        except ValueError as exc:
            raise DiscoveryError(str(exc)) from exc
        proposal["title"] = proposal.pop("migrationName")
        proposal["description"] = "MOCK_CODEX single-seam decomposition of the objective."
        proposal["dependsOn"] = []
        return [proposal]

    files = [
        file.relative_to(repo_path).as_posix()
        for file in parser.list_scannable_files(repo_path)
    ]
    tree = "\n".join(files[:_MAX_TREE_FILES])
    if len(files) > _MAX_TREE_FILES:
        tree += f"\n... and {len(files) - _MAX_TREE_FILES} more files"

    analysis = "\n".join(
        f"- {key}: {value}" for key, value in summary.items()
    )
    prompt = _PROMPT_TEMPLATE.format(objective=objective, analysis=analysis, tree=tree)
    try:
        # complete_json handles JSON mode, lenient extraction, and one
        # valid-JSON-only retry before giving up (see llm.complete_json).
        payload = llm.complete_json(prompt)
    except llm.LlmError as exc:
        raise DiscoveryError(f"Seam discovery invocation failed: {exc}") from exc

    proposals = payload.get("seams") if isinstance(payload, dict) else payload
    if not isinstance(proposals, list) or not proposals:
        raise DiscoveryError("Model discovery contained no seams")
    return [item for item in proposals if isinstance(item, dict)][:_MAX_SEAMS]


def _clean_depends_on(raw, seam_count: int, self_index: int) -> list[int]:
    if not isinstance(raw, list):
        return []
    deps: list[int] = []
    for item in raw:
        try:
            dep = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= dep < seam_count and dep != self_index and dep not in deps:
            deps.append(dep)
    return deps


def _execution_order(seams: list[dict]) -> list[dict]:
    """Stable topological order over dependsOn; falls back to given order on cycles.

    dependsOn indexes refer to the original proposal order, so they are
    remapped to the surviving seams' seamIds after sorting.
    """
    by_id = {seam["seamId"]: seam for seam in seams}
    # Drop dependencies on seams that were dropped during grounding.
    for seam in seams:
        seam["dependsOn"] = [
            dep for dep in seam["dependsOn"] if f"seam-{dep}" in by_id
        ]

    ordered: list[dict] = []
    placed: set[str] = set()
    remaining = list(seams)
    while remaining:
        progressed = False
        for seam in list(remaining):
            if all(f"seam-{dep}" in placed for dep in seam["dependsOn"]):
                ordered.append(seam)
                placed.add(seam["seamId"])
                remaining.remove(seam)
                progressed = True
        if not progressed:  # dependency cycle: keep proposal order for the rest
            ordered.extend(remaining)
            break

    for position, seam in enumerate(ordered):
        seam["executionOrder"] = position
        seam["dependsOn"] = [f"seam-{dep}" for dep in seam["dependsOn"]]
    return ordered
