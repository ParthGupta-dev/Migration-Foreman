"""Phase 9 (frontend_refactor.md) — conversational chat, scoped to a campaign.

Persistence model
------------------
One row per turn in `chat_messages` (role: user | assistant | system),
foreign-keyed to the campaign it belongs to and optionally to the unit it
discusses (`unit_ref`, e.g. the Batches "Discuss in chat -> ?ref=B-xx" deep
link target). The whole transcript is replayable on reload via
GET /campaign/{id}/chat — there is no separate "session" object; the
campaign_id *is* the session key.

Endpoint contract
-----------------
- GET  /campaign/{id}/chat                      -> full transcript, oldest-first
- POST /campaign/{id}/chat                       -> {message, unitRef?} in,
  persists the user turn + a foreman reply, returns both
- POST /campaign/{id}/chat/retry-unit/{unitId}   -> the one re-dispatch action
  (see below), returns the updated unit + a system message recording it

LLM session continuation
-------------------------
llm.complete() is a stateless one-shot completion — the provider holds no
server-side conversation state. Continuation is therefore done here: each
turn rebuilds one prompt containing (a) live campaign/seam/unit context, (b)
the stored transcript so far, and (c) the new user message, and sends the
whole thing. This bounds cost via _HISTORY_TURN_LIMIT rather than growing
unbounded with campaign age.

Re-dispatch-from-chat semantics
--------------------------------
Chat can trigger exactly one real action: retrying a single unit that is
already in a terminal failure state (escalated / blocked / generation_failed
/ system_error). It is never inferred from free-text parsing of the model's
reply — only the explicit retry-unit endpoint can do it — and it re-enters
the *same* verification gate (verification/gate.py) the original campaign
run used, so attempts, retries, classification, unit_events, and the
campaign WebSocket broadcasts all behave identically to a first-pass run.
The action and its outcome are recorded both as a unit_events row (via
gate.run_unit itself) and as a system chat message, so the transcript stays
a complete audit trail of what was discussed and what was actually done.
"""

import asyncio
import logging
import uuid

import config
import db
import llm
import models
from errors import ApiError
from verification import gate

logger = logging.getLogger("migration_foreman.chat")

RETRYABLE_UNIT_STATUSES = {"escalated", "blocked", "generation_failed", "system_error"}

# How many prior turns to replay into the prompt each call -- bounds prompt
# size on long-running campaigns without truncating recent context.
_HISTORY_TURN_LIMIT = 20
_FAILURE_LOG_TAIL_CHARS = 2000


class ChatError(Exception):
    """The reply could not be generated (LLM provider misconfigured/failed)."""


def _row_to_message_out(row) -> models.ChatMessageOut:
    return models.ChatMessageOut(
        messageId=str(row["message_id"]),
        role=row["role"],
        content=row["content"],
        unitRef=str(row["unit_ref"]) if row["unit_ref"] else None,
        action=row["action"],
        createdAt=row["created_at"].isoformat(),
    )


async def get_history(campaign_id: str) -> list[models.ChatMessageOut]:
    rows = await db.fetch(
        "SELECT * FROM chat_messages WHERE campaign_id = $1 ORDER BY created_at ASC",
        campaign_id,
    )
    return [_row_to_message_out(row) for row in rows]


async def _append(
    campaign_id: str, role: str, content: str,
    unit_ref: str | None = None, action: str | None = None,
):
    row = await db.fetchrow(
        "INSERT INTO chat_messages (campaign_id, role, content, unit_ref, action) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING *",
        campaign_id, role, content, unit_ref, action,
    )
    return row


async def _campaign_context(campaign_id: str) -> dict:
    campaign = await db.fetchrow("SELECT * FROM campaigns WHERE campaign_id = $1", campaign_id)
    if campaign is None:
        raise ApiError(404, "campaign_not_found", f"No campaign with id {campaign_id}")
    seam = await db.fetchrow("SELECT * FROM seams WHERE seam_id = $1", campaign["seam_id"])
    units = await db.fetch(
        "SELECT * FROM units WHERE campaign_id = $1 ORDER BY created_at", campaign_id
    )
    return {"campaign": campaign, "seam": seam, "units": units}


def _build_prompt(ctx: dict, history: list, message: str, referenced_unit) -> str:
    seam = ctx["seam"]
    units = ctx["units"]
    status_counts: dict[str, int] = {}
    for unit in units:
        status_counts[unit["status"]] = status_counts.get(unit["status"], 0) + 1

    lines = [
        "You are Foreman, the migration assistant embedded in Migration "
        "Foreman's campaign chat. You help the operator understand and "
        "unblock this migration campaign. Be concise and specific.",
        "",
        "Campaign context:",
        f"- Migration: {seam['before_pattern']} -> {seam['after_pattern']}",
        f"- Test command: {seam['test_command']}",
        f"- Units: {len(units)} total, "
        + ", ".join(f"{count} {status}" for status, count in status_counts.items()),
    ]

    if referenced_unit is not None:
        tail = (referenced_unit["failure_log"] or "")[-_FAILURE_LOG_TAIL_CHARS:]
        lines += [
            "",
            f"The operator is asking about unit `{referenced_unit['scope_glob']}` "
            f"(status: {referenced_unit['status']}, attempt "
            f"{referenced_unit['attempt']}/{config.MAX_ATTEMPTS}):",
            "Failure log (tail):",
            tail or "(no failure log recorded)",
        ]
        if referenced_unit["status"] in RETRYABLE_UNIT_STATUSES:
            lines.append(
                "This unit can be retried; if you recommend that, say so "
                "explicitly so the operator can trigger it."
            )

    if history:
        lines.append("")
        lines.append("Conversation so far:")
        for turn in history[-_HISTORY_TURN_LIMIT:]:
            lines.append(f"{turn['role']}: {turn['content']}")

    lines += ["", f"user: {message}", "", "Respond as Foreman:"]
    return "\n".join(lines)


def _mock_reply(referenced_unit, message: str) -> str:
    if referenced_unit is None:
        return (
            "MOCK_CODEX: I don't have a specific unit to discuss yet -- open "
            "a failed batch and use \"Discuss in chat\" so I can see its "
            "failure log."
        )
    tail = (referenced_unit["failure_log"] or "").strip().splitlines()
    last_line = tail[-1] if tail else "(no failure log recorded)"
    retry_hint = (
        " This unit is retryable -- use the Retry unit action if you want "
        "me to run it again."
        if referenced_unit["status"] in RETRYABLE_UNIT_STATUSES else ""
    )
    return (
        f"MOCK_CODEX: {referenced_unit['scope_glob']} is {referenced_unit['status']} "
        f"after {referenced_unit['attempt']} attempt(s). Last log line: "
        f"{last_line!r}.{retry_hint}"
    )


async def reply(
    campaign_id: str, message: str, unit_ref: str | None
) -> tuple[models.ChatMessageOut, models.ChatMessageOut]:
    """Persist the user's turn and a foreman reply; returns both."""
    if not message.strip():
        raise ApiError(400, "chat_message_invalid", "message must be a non-empty string")

    ctx = await _campaign_context(campaign_id)
    referenced_unit = None
    if unit_ref is not None:
        unit_ref = str(_require_unit_uuid(unit_ref))
        referenced_unit = next(
            (u for u in ctx["units"] if str(u["unit_id"]) == unit_ref), None
        )
        if referenced_unit is None:
            raise ApiError(404, "unit_not_found", f"No unit {unit_ref} in campaign {campaign_id}")

    history = await db.fetch(
        "SELECT role, content FROM chat_messages WHERE campaign_id = $1 ORDER BY created_at ASC",
        campaign_id,
    )

    user_row = await _append(campaign_id, "user", message, unit_ref=unit_ref)

    if config.MOCK_CODEX:
        text = _mock_reply(referenced_unit, message)
    else:
        prompt = _build_prompt(ctx, history, message, referenced_unit)
        try:
            text = await asyncio.to_thread(llm.complete, prompt)
        except llm.LlmError as exc:
            raise ChatError(str(exc)) from exc

    assistant_row = await _append(campaign_id, "assistant", text, unit_ref=unit_ref)
    return _row_to_message_out(user_row), _row_to_message_out(assistant_row)


def _require_unit_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError(404, "unit_not_found", f"Invalid unit id: {value}")


async def retry_unit(campaign_id: str, unit_id: str):
    """The one re-dispatch action chat can trigger: re-run the verification
    gate for a single unit that already reached a terminal failure state.
    Returns the refreshed unit row (an asyncpg Record) and the system chat
    message recording the outcome."""
    ctx = await _campaign_context(campaign_id)
    unit = next((u for u in ctx["units"] if str(u["unit_id"]) == unit_id), None)
    if unit is None:
        raise ApiError(404, "unit_not_found", f"No unit {unit_id} in campaign {campaign_id}")
    if unit["status"] not in RETRYABLE_UNIT_STATUSES:
        raise ApiError(
            400, "unit_not_retryable",
            f"Unit status is '{unit['status']}'; retry requires one of "
            f"{sorted(RETRYABLE_UNIT_STATUSES)}",
        )

    seam = ctx["seam"]
    repo_path = config.REPOS_DIR / str(seam["repo_id"])
    if not repo_path.is_dir():
        raise ApiError(409, "repo_missing_on_disk", "Repo clone missing; re-ingest via POST /repo")

    campaign_branch = f"mf/campaign-{campaign_id[:8]}"
    seam_dict = {
        "beforePattern": seam["before_pattern"],
        "afterPattern": seam["after_pattern"],
        "invariants": list(seam["invariants"] or []),
        "testCommand": seam["test_command"],
    }
    repo_lock = asyncio.Lock()

    await _append(
        campaign_id, "system",
        f"Retrying unit {unit['scope_glob']} (was {unit['status']})...",
        unit_ref=unit_id, action="retry_unit",
    )
    final_status = await gate.run_unit(
        campaign_id, unit_id, unit["scope_glob"], seam_dict, repo_path, campaign_branch, repo_lock,
    )

    refreshed = await db.fetchrow("SELECT * FROM units WHERE unit_id = $1", unit_id)
    system_row = await _append(
        campaign_id, "system",
        f"Retry of {unit['scope_glob']} finished: {final_status}.",
        unit_ref=unit_id, action="retry_unit",
    )
    return refreshed, _row_to_message_out(system_row)
