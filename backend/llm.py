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
                          key is set wins

MOCK_CODEX=1 short-circuits in the callers before this module is reached.
"""

import logging
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


def active_provider() -> Provider:
    providers = _known_providers()

    if config.LLM_PROVIDER:
        provider = providers.get(config.LLM_PROVIDER)
        if provider is None:
            raise LlmError(
                f"LLM_PROVIDER={config.LLM_PROVIDER!r} needs LLM_API_KEY (and "
                "LLM_MODEL / LLM_BASE_URL) set for a custom provider"
            )
        _check(provider)
        return provider

    for name in providers:  # codex first, then groq, then custom
        provider = providers[name]
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


def complete(prompt: str) -> str:
    """One-shot completion via whichever provider the env selects."""
    provider = active_provider()
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise LlmError(f"openai package not installed: {exc}") from exc

    client = OpenAI(api_key=provider.api_key, base_url=provider.base_url)
    try:
        if provider.api == "responses":
            response = client.responses.create(model=provider.model, input=prompt)
            text = response.output_text
        else:
            response = client.chat.completions.create(
                model=provider.model,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.choices[0].message.content
    except Exception as exc:
        raise LlmError(f"{provider.name} invocation failed: {exc}") from exc

    if not text or not text.strip():
        raise LlmError(f"{provider.name} returned empty output")
    return text
