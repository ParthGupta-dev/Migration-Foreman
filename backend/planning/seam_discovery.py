"""AI Seam Discovery: high-level objective -> approved-ready candidate seams.

Evolves the planning layer from "one intent, one seam" (planner.py) to
"one objective, many candidate seams", staged so grounding never has to
happen before a candidate idea exists:

1. Repository intelligence (read-only): file census, language breakdown,
   dependency-graph stats, most-depended-on files, and module groups ranked
   by import centrality x recent commit activity. No Migration Foreman file,
   metadata, or prior seam is ever assumed to exist.
2. Idea generation: the LLM proposes a ranked list of migration
   OPPORTUNITIES from that intelligence plus the (optional, possibly empty
   or vague) objective -- title, rationale, affected modules, risk,
   confidence. No beforePattern/afterPattern/regex at this stage, so a
   vague or empty objective can never cause this step to fail: the
   objective only biases ranking, it is never converted directly into a
   pattern.
3. Per-idea grounding: only once an idea has been selected for grounding are
   its actual files inspected, and a concrete beforePattern/afterPattern
   generated from that real content, then validated against the repo
   (planner._validate). A grounding failure triggers replanning -- the same
   idea is regenerated with the failure reason attached -- for a bounded
   number of attempts before that one idea (not the whole discovery call) is
   dropped. The overall call only fails if every idea in the pool never
   grounds, which is a much narrower condition than "the objective was
   vague".

The result is advisory and stateless. Nothing executes from here: the client
presents the seams for human approval and submits each approved one through
the existing POST /repo/{id}/seam -> POST /campaign pipeline, so the
execution engine is untouched.

MOCK_CODEX=1: idea generation and per-idea grounding are both replaced with
deterministic, repo-driven stand-ins (no LLM reachable) so the whole flow —
including an empty/vague objective — still runs offline. An objective shaped
like "migrate X to Y" is still honored directly (unchanged from before, so
existing demo scripts/docs keep working byte-for-byte); anything else falls
back to a synthetic seam mined from the repo's own highest-ranked module.
"""

import logging
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import config
import llm
from discovery import graph as depgraph
from discovery import parser
from discovery import profiler
from discovery import ranking
from planning import planner
from repo_config import load_repo_config

logger = logging.getLogger("migration_foreman.seam_discovery")

_MAX_TREE_FILES = 300
_MAX_SEAMS = 6
_IDEA_POOL_SIZE = 10
_MAX_GROUNDING_ATTEMPTS = 2
# Per-idea grounding is an independent, blocking LLM round trip -- run the
# pool concurrently so an interactive discover() call doesn't serialize up
# to _IDEA_POOL_SIZE x _MAX_GROUNDING_ATTEMPTS LLM calls one at a time.
_GROUNDING_WORKERS = 4
_MAX_MODULE_GROUPS = 12
_MAX_PATTERN_FILES = 6
_MAX_CHARS_PER_FILE = 3000
# Rough per-file execution budget (attempt + verification) for the estimate.
_MINUTES_PER_FILE = 0.75

_RISK_ORDER = {"low": 0, "medium": 1, "high": 2}


class DiscoveryError(Exception):
    """No usable seam could be produced for this repository."""


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


def _module_groups(repo_path: Path) -> list[dict]:
    """Files grouped by top-level directory, ranked by import centrality x
    recent commit activity -- the same signal discovery/candidates.py uses
    for Scan mode, recomputed here (read-only, no repo_id cache needed) so
    idea generation can point at real, ranked areas of the codebase instead
    of inventing modules that don't exist."""
    graph = depgraph.build_graph(repo_path)
    centrality = depgraph.centrality_scores(graph)
    activity = ranking.recent_activity_scores(repo_path)

    groups: dict[str, list[str]] = {}
    for rel_path in graph.nodes:
        top = rel_path.split("/")[0] if "/" in rel_path else "."
        groups.setdefault(top, []).append(rel_path)

    modules = []
    for top, files in groups.items():
        centrality_sum = sum(centrality.get(f, 0.0) for f in files)
        activity_sum = sum(activity.get(f, 0.0) for f in files)
        modules.append({
            "module": top,
            "files": sorted(files),
            "combinedScore": centrality_sum * activity_sum,
        })

    peak = max((m["combinedScore"] for m in modules), default=0.0) or 1.0
    for m in modules:
        m["combinedScore"] = round(m["combinedScore"] / peak, 4)
    modules.sort(key=lambda m: m["combinedScore"], reverse=True)
    return modules[:_MAX_MODULE_GROUPS]


def discover_seams(repo_path: Path, objective: str, model: str | None = None) -> dict:
    """Analyze the repo, propose candidate ideas, ground the best ones.

    Returns the full discovery payload: repoSummary, grounded seams in
    dependency-respecting execution order, dropped seams with reasons, and
    campaign-level rollups (overall risk, file totals, time estimate).

    Nothing here requires a Migration Foreman file to exist: the repository
    profile (discovery/profiler.py) that grounds the model's proposals is
    inferred fresh from the clone every time, and .migration-foreman.json
    (if present) only ever supplies an optional blacklist override below.

    `model`, when given, is a specific model string from the frontend's
    model selector (GET /llm/providers, e.g. "llama-3.1-8b-instant") that
    overrides the env-selected default for this call only; llm.py resolves
    which provider hosts it. Ignored under MOCK_CODEX, which never reaches
    llm.py at all.
    """
    summary = analyze_repository(repo_path)
    profile = profiler.build_profile(repo_path)
    modules = _module_groups(repo_path)
    extra_blacklist = (load_repo_config(repo_path) or {}).get("blacklist")

    ideas = _propose_ideas(repo_path, objective, summary, profile, modules, model)
    if not ideas:
        raise DiscoveryError("Repository analysis produced no migration opportunities to propose")

    # Each idea's grounding is an independent, read-only, blocking LLM round
    # trip (Stage 6/7) -- running them concurrently keeps the interactive
    # "Autonomous mode" call from serializing what can be 1-2 attempts x up
    # to _IDEA_POOL_SIZE ideas into a single-file queue of LLM calls.
    results: dict[int, tuple[dict | None, str | None]] = {}
    with ThreadPoolExecutor(max_workers=min(_GROUNDING_WORKERS, len(ideas))) as pool:
        futures = {
            pool.submit(
                _ground_one_idea, repo_path, idea, objective, model, extra_blacklist
            ): index
            for index, idea in enumerate(ideas)
        }
        for future in as_completed(futures):
            results[futures[future]] = future.result()

    seams: list[dict] = []
    dropped: list[dict] = []
    for index, idea in enumerate(ideas):
        title = str(idea.get("title") or "").strip() or f"Opportunity {index + 1}"
        grounded, failure_reason = results[index]
        if grounded is None:
            dropped.append({
                "title": title,
                "reason": failure_reason or "could not derive a groundable pattern for this opportunity",
            })
            continue

        seams.append({
            "seamId": f"seam-{index}",
            "title": title,
            "description": str(idea.get("rationale") or "").strip(),
            "dependsOn": _clean_depends_on(idea.get("dependsOn"), len(ideas), index),
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

    # Ideas were already ranked by the proposal step; keep that order and cap
    # at _MAX_SEAMS rather than however many happened to ground.
    seams = seams[:_MAX_SEAMS]

    if not seams:
        reasons = "; ".join(item["reason"] for item in dropped) or "no opportunities proposed"
        raise DiscoveryError(
            f"Repository analysis proposed {len(ideas)} migration opportunity(ies), but none "
            f"could be grounded into a concrete, verifiable change ({reasons})"
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


def _ground_one_idea(
    repo_path: Path, idea: dict, objective: str,
    model: str | None, extra_blacklist: list[str] | None,
) -> tuple[dict | None, str | None]:
    """Stage 6/7 for one idea: generate a concrete pattern from its real
    files, validate it, and replan (regenerate with the failure reason) on a
    grounding failure -- up to _MAX_GROUNDING_ATTEMPTS before giving up on
    just this idea. Returns (grounded plan, None) or (None, failure reason).
    """
    title = str(idea.get("title") or "").strip() or "opportunity"
    failure_reason: str | None = None
    for attempt in range(_MAX_GROUNDING_ATTEMPTS):
        try:
            proposal = _generate_pattern(repo_path, idea, objective, model, failure_reason)
        except DiscoveryError as exc:
            failure_reason = str(exc)
            logger.info("Idea %r pattern generation attempt %d failed: %s", title, attempt + 1, exc)
            continue
        try:
            return planner._validate(repo_path, proposal, extra_blacklist), None
        except planner.PlanValidationError as exc:
            failure_reason = str(exc)
            logger.info("Idea %r grounding attempt %d failed: %s", title, attempt + 1, exc)
    return None, failure_reason


# --- Stage 1 formatting helpers ------------------------------------------


def _format_profile(profile: dict) -> str:
    lines = []
    for key in (
        "frameworks", "packageManager", "buildSystem", "testFramework",
        "sourceRoots", "importantDirectories", "entryPoints",
        "dependencyManifests", "ciConfig", "dockerConfig",
    ):
        value = profile.get(key)
        if value:
            lines.append(f"- {key}: {value}")
    return "\n".join(lines) if lines else "- (no strong signals detected; treat as a minimal/greenfield repo)"


def _format_modules(modules: list[dict]) -> str:
    if not modules:
        return "- (no import-graph signal; repository may be very small or non-code)"
    lines = []
    for m in modules:
        sample = ", ".join(m["files"][:6])
        more = f" (+{len(m['files']) - 6} more)" if len(m["files"]) > 6 else ""
        lines.append(f"- {m['module']}/ [rank {m['combinedScore']}]: {sample}{more}")
    return "\n".join(lines)


# --- Stage 3: idea generation (no patterns) ------------------------------

_IDEA_PROMPT_TEMPLATE = """You are a migration architect analyzing an unfamiliar codebase for the
very first time. Do not assume any Migration Foreman configuration, prior
seams, repository-specific annotations, or metadata of any kind exist.

Engineering objective (may be vague, generic, or completely empty --
use it ONLY to bias which real opportunities you rank higher; never invent
a pattern or module to satisfy it, and never fail if it is empty):
{objective_line}

Repository intelligence:
{analysis}

Repository profile (inferred automatically -- no configuration file
required or consulted):
{profile}

Modules ranked by import centrality x recent commit activity (the
repository's own highest-signal areas):
{modules}

Based on this repository's actual architecture, propose a ranked list of up
to {max_ideas} concrete migration OPPORTUNITIES -- not migration plans. Each
opportunity must name a real module from the list above and a real kind of
improvement for it (e.g. "replace hand-rolled session auth in auth/ with
OAuth", "introduce a service layer between api/ and db/", "extract shared
logging out of the top-level scripts"). Rank the opportunities most relevant
to the objective (if any) first; if the objective is empty or generic, rank
by the repository's own signal (centrality x activity) instead.

Do NOT include beforePattern, afterPattern, or any regex — patterns are
generated later, after an opportunity is selected and its files are
inspected directly. Your job here is only to identify WHERE and WHY, not
HOW, so this step must never fail for lack of a concrete pattern.

Return ONLY strict JSON, no markdown fences, exactly this shape:
{{"ideas": [
  {{"title": "Short Title Like 'Replace hand-rolled auth with OAuth'",
    "rationale": "two to four sentences: why this area, why now, what it improves",
    "modules": ["auth", "..."],
    "risk": "low" | "medium" | "high",
    "confidence": 0.0,
    "dependsOn": [0]}}
]}}
"""


_IDEA_GENERATION_ATTEMPTS = 2


def _propose_ideas(
    repo_path: Path, objective: str, summary: dict, profile: dict,
    modules: list[dict], model: str | None = None,
) -> list[dict]:
    if config.MOCK_CODEX:
        return _mock_ideas(repo_path, objective, modules)

    analysis = "\n".join(f"- {key}: {value}" for key, value in summary.items())
    prompt = _IDEA_PROMPT_TEMPLATE.format(
        objective_line=objective.strip() or "(none given)",
        analysis=analysis,
        profile=_format_profile(profile),
        modules=_format_modules(modules),
        max_ideas=_IDEA_POOL_SIZE,
    )

    for attempt in range(_IDEA_GENERATION_ATTEMPTS):
        try:
            payload = llm.complete_json(prompt, model=model)
        except llm.LlmError as exc:
            logger.warning("Idea generation invocation failed (attempt %d): %s", attempt + 1, exc)
            continue
        proposals = payload.get("ideas") if isinstance(payload, dict) else payload
        if isinstance(proposals, list) and proposals:
            return [item for item in proposals if isinstance(item, dict)][:_IDEA_POOL_SIZE]
        logger.warning("Idea generation returned no usable ideas (attempt %d)", attempt + 1)

    # Stage 4 resilience: idea generation itself is just one more LLM call
    # and can be unreliable (malformed shape, empty list) independent of
    # whether the objective was vague or empty -- never hard-fail the whole
    # discovery call over it. Fall back to the repository's own ranked
    # modules so Stage 6 (real pattern generation from real files) still
    # gets a fair shot at a concrete, groundable seam.
    logger.warning("Idea generation exhausted retries; falling back to repo-driven modules")
    return _repo_driven_ideas(modules)


def _repo_driven_ideas(modules: list[dict]) -> list[dict]:
    return [
        {
            "title": f"Modernize {m['module']}/",
            "rationale": (
                f"Chosen from the repository's own signal (rank {m['combinedScore']} by "
                "import centrality x recent commit activity): the model's own idea "
                "proposal round didn't return a usable list, so this opportunity is "
                "repository-driven rather than model-authored."
            ),
            "modules": [m["module"]],
            "risk": None,
            "confidence": 0.3,
            "dependsOn": [],
        }
        for m in modules[:_IDEA_POOL_SIZE]
    ] if modules else []


def _mock_ideas(repo_path: Path, objective: str, modules: list[dict]) -> list[dict]:
    """Offline stand-in for idea generation. A well-formed "X to Y" objective
    is still honored directly (unchanged behavior, so existing demo scripts
    keep working); anything else -- including empty -- falls back to the
    repository's own top-ranked module instead of failing."""
    match = planner._MOCK_INTENT.search(objective) or planner._MOCK_ARROW.search(objective)
    if match is not None:
        before, after = match.group(1), match.group(2)
        return [{
            "title": f"{before} -> {after}",
            "rationale": (
                f"MOCK_CODEX: the intent asks to move every use of {before!r} to "
                f"{after!r}, so call sites still on the old name would break once "
                "it is removed."
            ),
            "modules": [modules[0]["module"]] if modules else [],
            "risk": None,
            "confidence": 0.6,
            "dependsOn": [],
            "__mockDirectPattern__": (before, after),
        }]

    if not modules:
        return []
    top = modules[0]
    return [{
        "title": f"MOCK_CODEX repository-driven pick: {top['module']}/",
        "rationale": (
            "MOCK_CODEX: no objective could be parsed into a direct rename, so "
            f"this opportunity was chosen from the repository's own highest-ranked "
            f"module ({top['module']}/, rank {top['combinedScore']} by import "
            "centrality x recent activity) purely to demonstrate the pipeline offline."
        ),
        "modules": [top["module"]],
        "risk": None,
        "confidence": 0.4,
        "dependsOn": [],
    }]


# --- Stage 6/7: per-idea grounding (inspect files, generate pattern) -----

_PATTERN_PROMPT_TEMPLATE = """You are a migration architect. A candidate migration opportunity has been
selected from this repository; your job now is to turn it into one concrete,
mechanical, verifiable seam by inspecting the real code below.

Engineering objective (context only): {objective_line}

Selected opportunity: {title}
Rationale: {rationale}

Actual source of the affected module(s) (this is the ONLY code you may
ground a pattern in — beforePattern MUST occur verbatim in what's shown):
{excerpts}
{retry_note}
Rules:
- beforePattern must be a Python regex (or literal string) that occurs in
  the code shown above — it identifies what this seam migrates away from.
- afterPattern is the replacement this seam moves to.
- scopeGlobs select the files this seam migrates (e.g. "auth/**/*.py").
- risk is your judgment of how likely this seam is to break behavior.
- confidence is your 0.0-1.0 estimate that this pattern captures the
  opportunity described above.
- reasoning must explain WHY this seam exists and what breakage you expect.

Return ONLY strict JSON, no markdown fences, exactly this shape:
{{"beforePattern": "...", "afterPattern": "...", "scopeGlobs": ["..."],
  "invariants": ["..."], "testCommand": "..." or null,
  "risk": "low" | "medium" | "high", "breakingChanges": true or false,
  "confidence": 0.0, "reasoning": "two to four sentences"}}
"""


def _gather_module_excerpts(repo_path: Path, module_names: list[str], summary: dict | None = None) -> str:
    scannable = parser.list_scannable_files(repo_path)
    rel_index = {f.relative_to(repo_path).as_posix(): f for f in scannable}

    matched: list[str] = []
    for rel in sorted(rel_index):
        top = rel.split("/")[0] if "/" in rel else "."
        if top in module_names or rel in module_names:
            matched.append(rel)

    if not matched and summary:
        # The idea named a module that doesn't map to a real path (rare
        # hallucination) -- fall back to the repo's globally most-central
        # files so pattern generation still has real content to work from.
        matched = [f for f in summary.get("mostDependedOnFiles", []) if f in rel_index]
    if not matched:
        matched = list(rel_index)[:_MAX_PATTERN_FILES]

    blocks = []
    for rel in matched[:_MAX_PATTERN_FILES]:
        try:
            text = rel_index[rel].read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        blocks.append(f"--- {rel} ---\n{text[:_MAX_CHARS_PER_FILE]}")
    return "\n\n".join(blocks) if blocks else "(no readable source files found)"


def _generate_pattern(
    repo_path: Path, idea: dict, objective: str,
    model: str | None = None, failure_reason: str | None = None,
) -> dict:
    if config.MOCK_CODEX:
        return _mock_pattern(repo_path, idea)

    excerpts = _gather_module_excerpts(repo_path, [str(m) for m in (idea.get("modules") or [])])
    retry_note = (
        f"\nA previous attempt at this opportunity failed grounding: {failure_reason}\n"
        "Propose a different, more precise pattern that actually appears in the code "
        "shown above.\n"
        if failure_reason else ""
    )
    prompt = _PATTERN_PROMPT_TEMPLATE.format(
        objective_line=objective.strip() or "(none given)",
        title=idea.get("title") or "",
        rationale=idea.get("rationale") or "",
        excerpts=excerpts,
        retry_note=retry_note,
    )
    try:
        proposal = llm.complete_json(prompt, model=model)
    except llm.LlmError as exc:
        raise DiscoveryError(f"Pattern generation invocation failed: {exc}") from exc
    if not isinstance(proposal, dict):
        raise DiscoveryError("Pattern generation returned no usable plan")
    proposal.setdefault("migrationName", idea.get("title"))
    return proposal


_MOCK_STOPWORDS = {
    "def", "class", "self", "return", "import", "from", "none", "true", "false",
    "function", "const", "let", "var", "export", "default", "async", "await",
    "public", "private", "static", "void", "int", "str", "new", "this", "for",
    "while", "if", "else", "elif", "try", "except", "finally", "with", "as",
    "print", "pass", "break", "continue", "yield", "lambda", "global",
}
_MOCK_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{3,}")


def _mock_pattern(repo_path: Path, idea: dict) -> dict:
    """Offline stand-in for pattern generation. A direct "X to Y" objective
    (see _mock_ideas) already carries its own literal pattern; anything else
    mines the most frequent real identifier out of the idea's module so
    grounding is guaranteed to succeed against real content."""
    direct = idea.get("__mockDirectPattern__")
    if direct:
        before, after = direct
        return {
            "migrationName": f"{before} -> {after}",
            "beforePattern": before,
            "afterPattern": after,
            "scopeGlobs": [],  # validation grounds scope in actual occurrences
            "invariants": ["All existing tests pass"],
            "testCommand": None,
            "risk": None,
            "breakingChanges": True,
            "confidence": 0.6,
            "reasoning": (
                f"MOCK_CODEX: the intent asks to move every use of {before!r} to "
                f"{after!r}, so call sites still on the old name would break once "
                "it is removed."
            ),
        }

    excerpts_source = [str(m) for m in (idea.get("modules") or [])]
    scannable = parser.list_scannable_files(repo_path)
    rel_index = {f.relative_to(repo_path).as_posix(): f for f in scannable}
    matched = [
        rel for rel in rel_index
        if (rel.split("/")[0] if "/" in rel else ".") in excerpts_source
    ] or list(rel_index)

    counts: Counter[str] = Counter()
    for rel in matched:
        try:
            text = rel_index[rel].read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for token in _MOCK_TOKEN_RE.findall(text):
            if token.lower() not in _MOCK_STOPWORDS:
                counts[token] += 1

    if not counts:
        raise DiscoveryError(
            "MOCK_CODEX could not mine a real identifier from the selected module "
            "to demonstrate a pattern"
        )
    token, _ = counts.most_common(1)[0]
    return {
        "migrationName": f"{token} -> {token}_v2",
        "beforePattern": token,
        "afterPattern": f"{token}_v2",
        "scopeGlobs": [],
        "invariants": ["All existing tests pass"],
        "testCommand": None,
        "risk": None,
        "breakingChanges": True,
        "confidence": 0.4,
        "reasoning": (
            f"MOCK_CODEX: {token!r} is the most frequently referenced identifier in "
            "the selected module, mined directly from the real source so this "
            "demonstration is guaranteed to ground."
        ),
    }


# --- shared ordering helpers (unchanged) ---------------------------------


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
