"""Per-unit migration agent invocation, provider-agnostic via llm.py.

Historically Codex-only; the actual API (Codex, Groq, or any custom
OpenAI-compatible endpoint) is now selected entirely by the env — see llm.py.

One agent invocation per unit, scoped to that unit's single file, given the
seam's before/after pattern + invariants. On retry the previous attempt's
failure log is appended as additional context (PROJECT.md section 9). Each
invocation returns the migrated contents plus a short RATIONALE line, which
the gate streams to the frontend over the unit_reasoning WebSocket event.

MOCK_CODEX=1 (flagged deviation, offline dev/demo): replaces the API call
with a deterministic regex rewrite of beforePattern -> afterPattern. This
exercises the whole pipeline without a key — and, being a naive textual
swap, naturally produces real test failures on files whose call sites need
more than a rename, which is exactly the retry/escalation demo path.
"""

import logging
import re

import config
import llm

logger = logging.getLogger("migration_foreman.codex")

_PROMPT_TEMPLATE = """You are a code migration agent. Migrate exactly one file.

Migration seam:
- Before pattern (migrate away from): {before}
- After pattern (migrate to): {after}
- Invariants that must hold after migration:
{invariants}

File path: {path}

Current file contents:
```
{content}
```
{failure_context}
Respond in EXACTLY this format, with no markdown fences:
RATIONALE: <one or two sentences: what you changed in this file, why, and any risk you see>
<the complete migrated file contents, starting on the very next line>
"""


class CodexInvocationError(Exception):
    pass


def _strip_fences(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```[\w+-]*\n(.*)\n```$", text, re.DOTALL)
    return match.group(1) if match else text


def _split_rationale(text: str) -> tuple[str, str]:
    """Split the model output into (file contents, rationale).

    Tolerates a missing RATIONALE line: the whole output is then treated as
    file contents so a format slip never corrupts a migration.
    """
    if text.lstrip().startswith("RATIONALE:"):
        first, _, rest = text.lstrip().partition("\n")
        return rest.lstrip("\n"), first[len("RATIONALE:"):].strip()
    return text, ""


def _mock_migrate(content: str, before: str, after: str) -> tuple[str, str]:
    try:
        migrated, count = re.subn(before, after, content)
    except re.error:
        migrated, count = content.replace(before, after), content.count(before)
    if count == 0:
        logger.info("MOCK_CODEX: pattern %r not found; file returned unchanged", before)
        rationale = f"MOCK_CODEX: pattern {before!r} not found; file left unchanged"
    else:
        rationale = (
            f"MOCK_CODEX: replaced {count} occurrence(s) of {before!r} with {after!r} "
            "(deterministic textual rewrite; call sites needing more than a rename will fail tests)"
        )
    return migrated, rationale


def migrate_file(
    file_path: str,
    content: str,
    before_pattern: str,
    after_pattern: str,
    invariants: list[str],
    failure_log: str | None = None,
    provider_name: str | None = None,
) -> tuple[str, str]:
    """Return (migrated file contents, short migration rationale) for one unit.

    `provider_name` is the seam's persisted model-selector choice (G8) —
    None falls through to llm.py's env-precedence default, unchanged from
    before this was wired.
    """
    if config.MOCK_CODEX:
        return _mock_migrate(content, before_pattern, after_pattern)

    failure_context = ""
    if failure_log:
        failure_context = (
            "\nThe previous migration attempt FAILED verification. "
            "Test output from the failed attempt:\n```\n"
            + failure_log[-4000:]
            + "\n```\nFix the migration so these tests pass.\n"
        )

    prompt = _PROMPT_TEMPLATE.format(
        before=before_pattern,
        after=after_pattern,
        invariants="\n".join(f"  - {inv}" for inv in invariants) or "  - (none specified)",
        path=file_path,
        content=content,
        failure_context=failure_context,
    )

    try:
        text = llm.complete(prompt, provider_name=provider_name)
    except llm.LlmError as exc:  # LLM failure -> consumes a retry (section 11)
        raise CodexInvocationError(str(exc)) from exc

    migrated, rationale = _split_rationale(text)
    return _strip_fences(migrated), rationale
