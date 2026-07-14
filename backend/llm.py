"""Provider-agnostic LLM client — the env file decides who answers.

The planner and the per-unit migrator both call complete() and stay
provider-blind. Which API actually serves the request is resolved entirely
from the environment:

- LLM_PROVIDER=codex   -> OpenAI Responses API (OPENAI_API_KEY, CODEX_MODEL)
- LLM_PROVIDER=groq    -> Groq chat completions (GROQ_API_KEY, GROQ_MODEL,
                          GROQ_BASE_URL)
- LLM_PROVIDER=<name>  -> any OpenAI-compatible endpoint via the generic
                          LLM_API_KEY / LLM_BASE_URL / LLM_MODEL trio
                          (e.g. LLM_PROVIDER=ollama with
                          LLM_BASE_URL=http://localhost:11434/v1)
- LLM_PROVIDER unset   -> auto-detect: first of codex / groq / custom whose
                          key is set wins (so adding OPENAI_API_KEY later
                          switches to codex without touching anything else)

MOCK_CODEX=1 short-circuits in the callers before this module is reached.
"""

import json
import logging
import re
import time
from dataclasses import dataclass

import config

logger = logging.getLogger("migration_foreman.llm")


class LlmError(Exception):
    """Provider misconfiguration or invocation failure."""


@dataclass(frozen=True)
class Provider:
    name: str
    api_key: str
    model: str
    base_url: str | None = None
    api: str = "chat"  # "responses" (OpenAI Codex) or "chat" (everything else)


@dataclass(frozen=True)
class ModelInfo:
    provider: str
    model: str
    usage: str  # "low" | "mid" | "high" -- see _MODEL_CATALOG


# Curated per-provider model catalog for the frontend's model selector
# (GET /llm/providers). `usage` is a static, hand-maintained tier -- not a
# live quota reading -- meant to help a human avoid picking something that
# burns through a rate-limited/metered plan too fast: "low" = small/fast/
# cheap, "mid" = balanced, "high" = large flagship, heaviest on quota and
# latency. Update this list if a provider retires/renames a model.
_MODEL_CATALOG: list[ModelInfo] = [
    ModelInfo("groq", "llama-3.1-8b-instant", "low"),
    ModelInfo("groq", "openai/gpt-oss-20b", "mid"),
    ModelInfo("groq", "llama-3.3-70b-versatile", "high"),
    ModelInfo("groq", "openai/gpt-oss-120b", "high"),
    ModelInfo("codex", "gpt-5-mini", "low"),
    ModelInfo("codex", "gpt-4.1", "mid"),
    ModelInfo("codex", "gpt-5", "high"),
    ModelInfo("codex", "gpt-5-codex", "high"),
]


def _known_providers() -> dict[str, Provider]:
    providers = {
        "codex": Provider(
            "codex", config.OPENAI_API_KEY, config.CODEX_MODEL, None, "responses"
        ),
        "groq": Provider(
            "groq", config.GROQ_API_KEY, config.GROQ_MODEL, config.GROQ_BASE_URL
        ),
    }
    custom_name = config.LLM_PROVIDER or "custom"
    if custom_name not in providers and (config.LLM_API_KEY or config.LLM_BASE_URL):
        providers[custom_name] = Provider(
            custom_name, config.LLM_API_KEY, config.LLM_MODEL,
            config.LLM_BASE_URL or None,
        )
    return providers


def list_providers() -> list[Provider]:
    """Every provider with an API key set. Order matches the env-precedence
    order (codex, groq, custom) so the first entry is the default one."""
    return [p for p in _known_providers().values() if p.api_key]


def list_models() -> list[ModelInfo]:
    """Every selectable model across providers with a configured API key —
    what GET /llm/providers offers the frontend's model selector. The
    "custom" provider (LLM_PROVIDER=<name>) has no curated catalog entry
    (its model is arbitrary), so it's surfaced as its own single configured
    model at a "mid" usage tier."""
    configured = {p.name for p in list_providers()}
    models = [m for m in _MODEL_CATALOG if m.provider in configured]
    for provider in _known_providers().values():
        if provider.name not in ("codex", "groq") and provider.api_key:
            models.append(ModelInfo(provider.name, provider.model, "mid"))
    return models


def _provider_for_model(model: str) -> str | None:
    for entry in _MODEL_CATALOG:
        if entry.model == model:
            return entry.provider
    for provider in _known_providers().values():
        if provider.name not in ("codex", "groq") and provider.model == model:
            return provider.name
    return None


def active_provider(model: str | None = None) -> Provider:
    """Resolve which provider (and model) serves a request.

    `model`, when given, is an explicit caller override (e.g. the frontend's
    model selector) — it must be one of list_models()'s model strings. The
    provider that hosts it is looked up automatically, so callers only ever
    need to think in terms of models, not providers. Without an override,
    falls back to LLM_PROVIDER env or the codex/groq/custom precedence, as
    before (that provider's own env-configured default model).
    """
    providers = _known_providers()

    if model:
        provider_name = _provider_for_model(model)
        base = providers.get(provider_name) if provider_name else None
        if base is None:
            raise LlmError(f"Unknown or unconfigured model: {model!r}")
        _check(base)
        return Provider(base.name, base.api_key, model, base.base_url, base.api)

    if config.LLM_PROVIDER:
        provider = providers.get(config.LLM_PROVIDER)
        if provider is None:
            raise LlmError(
                f"LLM_PROVIDER={config.LLM_PROVIDER!r} needs LLM_API_KEY (and "
                "LLM_MODEL / LLM_BASE_URL) set for a custom provider"
            )
        _check(provider)
        return provider

    for provider_name in providers:  # codex first, then groq, then custom
        provider = providers[provider_name]
        if provider.api_key:
            _check(provider)
            return provider
    raise LlmError(
        "No LLM provider configured: set OPENAI_API_KEY (codex), GROQ_API_KEY "
        "(groq), or LLM_PROVIDER + LLM_API_KEY/LLM_MODEL — or MOCK_CODEX=1"
    )


def _check(provider: Provider) -> None:
    if not provider.api_key:
        raise LlmError(f"Provider {provider.name!r} selected but its API key is not set")
    if not provider.model:
        raise LlmError(f"Provider {provider.name!r} selected but its model is not set")


def describe() -> str:
    """Human-readable active provider, e.g. 'groq:llama-3.3-70b-versatile'."""
    if config.MOCK_CODEX:
        return "mock"
    try:
        provider = active_provider()
        return f"{provider.name}:{provider.model}"
    except LlmError:
        return "unconfigured"


def complete(prompt: str, json_mode: bool = False, model: str | None = None) -> str:
    """One-shot completion via whichever provider the env selects (or the
    caller's explicit `model` override — see active_provider()).

    json_mode=True requests the provider's native structured-output mode
    (`response_format: json_object` on chat completions, the text format on
    the Responses API). Providers/models that reject the parameter fall back
    to a plain completion — callers still get text either way.
    """
    provider = active_provider(model)
    try:
        from openai import OpenAI, RateLimitError
    except ImportError as exc:
        raise LlmError(f"openai package not installed: {exc}") from exc

    client = OpenAI(api_key=provider.api_key, base_url=provider.base_url)

    def invoke(use_json: bool) -> str:
        if provider.api == "responses":
            kwargs: dict = {"model": provider.model, "input": prompt}
            if use_json:
                kwargs["text"] = {"format": {"type": "json_object"}}
            return client.responses.create(**kwargs).output_text
        kwargs = {
            "model": provider.model,
            "messages": [{"role": "user", "content": prompt}],
        }
        if use_json:
            kwargs["response_format"] = {"type": "json_object"}
        return client.chat.completions.create(**kwargs).choices[0].message.content

    text = ""
    for rate_attempt in range(_RATE_LIMIT_RETRIES + 1):
        try:
            try:
                text = invoke(json_mode)
            except RateLimitError:
                raise
            except Exception as exc:
                if not json_mode:
                    raise
                # Not every model behind an OpenAI-compatible endpoint supports
                # JSON mode; degrade to a plain completion rather than failing.
                logger.debug("%s rejected JSON mode (%s); retrying without", provider.name, exc)
                text = invoke(False)
            if text and text.strip():
                break
            # Reasoning models (e.g. gpt-oss on Groq) occasionally emit an
            # empty completion; like a 429, that transient must not consume
            # one of the unit's MAX_ATTEMPTS — retry the same call.
            if rate_attempt == _RATE_LIMIT_RETRIES:
                raise LlmError(f"{provider.name} returned empty output")
            logger.warning(
                "%s returned empty output; retry %d/%d",
                provider.name, rate_attempt + 1, _RATE_LIMIT_RETRIES,
            )
            time.sleep(1)
        except RateLimitError as exc:
            # A transient per-minute rate limit must not consume one of the
            # unit's MAX_ATTEMPTS: wait out the provider's suggested delay
            # (parallel units share one quota) and try the same call again.
            if rate_attempt == _RATE_LIMIT_RETRIES:
                raise LlmError(f"{provider.name} invocation failed: {exc}") from exc
            match = _RETRY_AFTER_RE.search(str(exc))
            delay = min(float(match.group(1)) + 1.0, 60.0) if match else 15.0
            logger.warning(
                "%s rate limited; sleeping %.1fs before retry %d/%d",
                provider.name, delay, rate_attempt + 1, _RATE_LIMIT_RETRIES,
            )
            time.sleep(delay)
        except LlmError:
            raise
        except Exception as exc:
            raise LlmError(f"{provider.name} invocation failed: {exc}") from exc

    if not text or not text.strip():
        raise LlmError(f"{provider.name} returned empty output")
    return text


_RATE_LIMIT_RETRIES = 3
# Groq 429 messages include the wait, e.g. "Please try again in 5.925s"
_RETRY_AFTER_RE = re.compile(r"try again in (\d+(?:\.\d+)?)s")

_FENCE_RE = re.compile(r"^```[\w+-]*\n(.*)\n```$", re.DOTALL)

_JSON_RETRY_REMINDER = (
    "\n\nIMPORTANT: Your previous reply was not valid JSON. Respond again with "
    "ONLY a single valid JSON object — no markdown fences, no commentary, and "
    "no text before or after the JSON."
)


def _extract_json(text: str):
    """Parse model output into JSON, tolerating fences and surrounding prose.

    Tries, in order: the whole (fence-stripped) text, then the first balanced
    JSON object/array found anywhere in it. Raises ValueError if nothing parses.
    """
    cleaned = text.strip()
    match = _FENCE_RE.match(cleaned)
    if match:
        cleaned = match.group(1).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(cleaned):
        if char in "{[":
            try:
                value, _ = decoder.raw_decode(cleaned, index)
                return value
            except json.JSONDecodeError:
                continue
    raise ValueError("no parseable JSON object found in model output")


def complete_json(prompt: str, model: str | None = None):
    """Completion that must yield JSON, robust to sloppy model output.

    Strategy: ask with the provider's JSON mode; parse leniently (fences and
    surrounding prose tolerated); on a malformed reply retry once with an
    explicit valid-JSON-only reminder. Raw output is logged at DEBUG so
    malformed replies can be diagnosed. Raises LlmError only after every
    recovery attempt fails.
    """
    last_error: Exception | None = None
    current_prompt = prompt
    for attempt in (1, 2):
        text = complete(current_prompt, json_mode=True, model=model)
        logger.debug("Raw model JSON output (attempt %d): %r", attempt, text)
        try:
            return _extract_json(text)
        except ValueError as exc:
            last_error = exc
            logger.warning("Model returned malformed JSON (attempt %d): %s", attempt, exc)
            current_prompt = prompt + _JSON_RETRY_REMINDER
    raise LlmError(f"model did not return valid JSON after retry: {last_error}")
