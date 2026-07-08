"""Per-unit Codex invocation via the OpenAI Responses API.

One agent invocation per unit, scoped to that unit's single file, given the
seam's before/after pattern + invariants. On retry the previous attempt's
failure log is appended as additional context (PROJECT.md section 9).

MOCK_CODEX=1 (flagged deviation, offline dev/demo): replaces the API call
with a deterministic regex rewrite of beforePattern -> afterPattern. This
exercises the whole pipeline without a key — and, being a naive textual
swap, naturally produces real test failures on files whose call sites need
more than a rename, which is exactly the retry/escalation demo path.
"""

import logging
import re

import config

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
Return ONLY the complete migrated file contents. No explanations, no markdown fences.
"""


class CodexInvocationError(Exception):
    pass


def _strip_fences(text: str) -> str:
    text = text.strip()
    match = re.match(r"^```[\w+-]*\n(.*)\n```$", text, re.DOTALL)
    return match.group(1) if match else text


def _mock_migrate(content: str, before: str, after: str) -> str:
    try:
        migrated, count = re.subn(before, after, content)
    except re.error:
        migrated, count = content.replace(before, after), content.count(before)
    if count == 0:
        logger.info("MOCK_CODEX: pattern %r not found; file returned unchanged", before)
    return migrated


def migrate_file(
    file_path: str,
    content: str,
    before_pattern: str,
    after_pattern: str,
    invariants: list[str],
    failure_log: str | None = None,
) -> str:
    """Return the full migrated contents for one unit's file."""
    if config.MOCK_CODEX:
        return _mock_migrate(content, before_pattern, after_pattern)

    if not config.OPENAI_API_KEY:
        raise CodexInvocationError("OPENAI_API_KEY not set and MOCK_CODEX disabled")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise CodexInvocationError(f"openai package not installed: {exc}") from exc

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
        client = OpenAI(api_key=config.OPENAI_API_KEY)
        response = client.responses.create(model=config.CODEX_MODEL, input=prompt)
        text = response.output_text
    except Exception as exc:  # Codex API failure -> consumes a retry (section 11)
        raise CodexInvocationError(f"Codex invocation failed: {exc}") from exc

    if not text or not text.strip():
        raise CodexInvocationError("Codex returned empty output")
    return _strip_fences(text)
