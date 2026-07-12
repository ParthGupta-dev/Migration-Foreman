"""Central env-driven configuration for the Migration Foreman backend.

All values come from the environment (.env via python-dotenv). Defaults are
chosen so the backend boots for local dev with just `docker compose up`.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/migration_foreman"
)
GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")

# --- LLM provider selection (see llm.py) --------------------------------
# LLM_PROVIDER picks which API drives planning + migration: "codex", "groq",
# or any custom name backed by the generic LLM_* trio. Empty = auto-detect
# from whichever key is set.
LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "").strip().lower()

# OpenAI / Codex (Responses API)
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
CODEX_MODEL: str = os.getenv("CODEX_MODEL", "gpt-5-codex")

# Groq (OpenAI-compatible chat completions)
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_BASE_URL: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

# Any other OpenAI-compatible endpoint (LLM_PROVIDER set to a custom name)
LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "")

# MOCK_CODEX=1 replaces the OpenAI Responses API call with a deterministic
# local pattern rewrite so the full pipeline (worktrees, tests, retries,
# escalation, WebSocket stream) can run offline. See execution/codex.py.
MOCK_CODEX: bool = os.getenv("MOCK_CODEX", "0").lower() in ("1", "true", "yes")

FRONTEND_BASE_URL: str = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
BACKEND_BASE_URL: str = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")

DATA_DIR: Path = Path(os.getenv("DATA_DIR", "./data")).resolve()
REPOS_DIR: Path = DATA_DIR / "repos"
WORKTREES_DIR: Path = DATA_DIR / "worktrees"

MAX_ATTEMPTS: int = int(os.getenv("MAX_ATTEMPTS", "3"))
UNIT_PARALLELISM: int = int(os.getenv("UNIT_PARALLELISM", "3"))
TEST_TIMEOUT_SECONDS: int = int(os.getenv("TEST_TIMEOUT_SECONDS", "300"))

# Optional per-repo seam config file (see repo_config.py). Lets a candidate
# confirmation carry before/after/testCommand without a manual seam.
REPO_CONFIG_FILENAME: str = ".migration-foreman.json"
