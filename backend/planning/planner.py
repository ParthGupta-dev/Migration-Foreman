"""Seam grounding & validation library for the AI planning pipeline.

This module is the single place where a model-proposed seam is checked
against reality before it can reach the pipeline: the beforePattern must
occur in at least one source file, and scope globs that match nothing (or
miss every occurrence) are repaired to the files where the pattern actually
appears.

Generation lives in planning/seam_discovery.py (POST /repo/{id}/discover) —
the one planning implementation shared by AI Discovery and Autonomous modes.
This module supplies its `_validate` grounding pass and the `_mock_plan`
offline stand-in (MOCK_CODEX=1 parses "migrate X to Y"-shaped intents
directly so the pipeline runs without a key).
"""

import logging
import re
from pathlib import Path

from discovery import parser
from execution import splitter

logger = logging.getLogger("migration_foreman.planner")

# "upgrade/migrate/replace/convert/switch X to/with Y" or bare "X -> Y"
_MOCK_INTENT = re.compile(
    r"(?:upgrade|migrate|replace|convert|switch|move|rename)\s+(?:from\s+)?"
    r"['\"`]?([\w.\-]+)['\"`]?\s+(?:to|with|->)\s+['\"`]?([\w.\-]+)['\"`]?",
    re.IGNORECASE,
)
_MOCK_ARROW = re.compile(r"['\"`]?([\w.\-]+)['\"`]?\s*->\s*['\"`]?([\w.\-]+)['\"`]?")


class PlanValidationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _mock_plan(intent: str) -> dict:
    match = _MOCK_INTENT.search(intent) or _MOCK_ARROW.search(intent)
    if match is None:
        raise ValueError(
            "MOCK_CODEX planner could not parse the intent; phrase it like "
            "'migrate <before> to <after>'"
        )
    before, after = match.group(1), match.group(2)
    return {
        "migrationName": f"{before} -> {after}",
        "beforePattern": before,
        "afterPattern": after,
        "scopeGlobs": [],  # validation grounds scope in actual occurrences
        "invariants": ["All existing tests pass"],
        "testCommand": None,
        "risk": None,  # derived from grounding during validation
        "breakingChanges": True,  # a rename breaks any un-migrated call site
        "confidence": 0.6,
        "reasoning": (
            f"MOCK_CODEX: the intent asks to move every use of {before!r} to "
            f"{after!r}, so call sites still on the old name would break once "
            "it is removed."
        ),
    }


def _validate(repo_path: Path, plan: dict) -> dict:
    before = str(plan.get("beforePattern") or "").strip()
    after = str(plan.get("afterPattern") or "").strip()
    if not before or not after:
        raise PlanValidationError(
            "plan_incomplete", "Plan is missing beforePattern or afterPattern"
        )

    try:
        confidence = float(plan.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = min(max(confidence, 0.0), 1.0)

    raw_globs = plan.get("scopeGlobs") or []
    globs = [g.strip() for g in raw_globs if isinstance(g, str) and g.strip()]

    try:
        pattern = re.compile(before)
        count_in = lambda text: len(pattern.findall(text))
    except re.error:
        count_in = lambda text: text.count(before)

    # occurrence census: repo-relative path -> match count
    occurrences: dict[str, int] = {}
    for file in parser.list_scannable_files(repo_path):
        try:
            text = file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        count = count_in(text)
        if count:
            occurrences[file.relative_to(repo_path).as_posix()] = count
    if not occurrences:
        raise PlanValidationError(
            "plan_pattern_not_found",
            f"beforePattern {before!r} does not occur in any source file; "
            "the intent may not apply to this repository",
        )
    hits = sorted(occurrences)

    repaired = False
    if globs:
        scoped = splitter.split_units(repo_path, globs)
        grounded = [rel for rel in scoped if rel in occurrences]
        if grounded:
            unsupported = [rel for rel in scoped if rel not in occurrences]
        else:
            # Scope repair: the proposed globs miss every real occurrence, so
            # ground the scope in the files where the pattern actually is.
            logger.info("Plan scope %s missed all %d occurrences; repaired", globs, len(hits))
            globs, grounded, unsupported, repaired = list(hits), hits, [], True
    else:
        globs, grounded, unsupported = list(hits), hits, []
    matched_occurrences = sum(occurrences[rel] for rel in grounded)

    risk = str(plan.get("risk") or "").strip().lower()
    if risk not in ("low", "medium", "high"):
        # Fallback: judge blast radius by how many files the migration touches.
        risk = "low" if len(grounded) <= 3 else "medium" if len(grounded) <= 10 else "high"

    reasoning = str(plan.get("reasoning") or plan.get("rationale") or "").strip()
    grounding_note = (
        f"Pattern grounded in {len(grounded)} file(s) "
        f"with {matched_occurrences} occurrence(s)."
    )
    if repaired:
        grounding_note += " Scope was repaired to the files containing the pattern."
    reasoning = f"{reasoning} {grounding_note}".strip()

    migration_name = str(plan.get("migrationName") or "").strip() or f"{before} -> {after}"
    invariants = plan.get("invariants") or []
    if not isinstance(invariants, list):
        invariants = []
    test_command = plan.get("testCommand")
    if not isinstance(test_command, str) or not test_command.strip():
        test_command = None

    return {
        "migrationName": migration_name,
        "beforePattern": before,
        "afterPattern": after,
        "scopeGlobs": globs,
        "invariants": [str(item) for item in invariants],
        "testCommand": test_command,
        "risk": risk,
        "breakingChanges": bool(plan.get("breakingChanges")),
        "confidence": round(confidence, 2),
        "reasoning": reasoning,
        "groundedFiles": grounded,
        "matchedOccurrences": matched_occurrences,
        "unsupportedFiles": unsupported,
        "repairedScope": repaired,
    }
