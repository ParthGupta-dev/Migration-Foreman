-- Schema per docs/PROJECT.md section 7 (locked). IF NOT EXISTS added so the
-- backend can bootstrap idempotently on startup.

CREATE TABLE IF NOT EXISTS repos (
  repo_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pulling', 'ready', 'failed')) DEFAULT 'pulling',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seams (
  seam_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id        UUID NOT NULL REFERENCES repos(repo_id) ON DELETE CASCADE,
  scope_globs    TEXT[] NOT NULL,
  before_pattern TEXT NOT NULL,
  after_pattern  TEXT NOT NULL,
  invariants     TEXT[],
  test_command   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seam_id      UUID NOT NULL REFERENCES seams(seam_id),
  status       TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')) DEFAULT 'running',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS units (
  unit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  scope_glob   TEXT NOT NULL,
  -- Terminal states beyond passed/escalated (verification/gate.py):
  -- blocked = LLM/provider infra failure on every attempt (429, timeout,
  --   empty response, provider down) -- never reached a real verification.
  -- generation_failed = the model responded but never produced usable
  --   migration content.
  -- system_error = an unexpected internal/environment failure. None of
  -- these three belong in the human Review queue -- only "escalated" does.
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'retrying', 'escalated', 'blocked', 'generation_failed', 'system_error')) DEFAULT 'pending',
  attempt      INTEGER NOT NULL DEFAULT 0,
  diff         TEXT,
  failure_log  TEXT,
  test_log     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upgrades for databases created before these existed.
ALTER TABLE units ADD COLUMN IF NOT EXISTS test_log TEXT;
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_status_check;
ALTER TABLE units ADD CONSTRAINT units_status_check CHECK (status IN ('pending', 'running', 'passed', 'failed', 'retrying', 'escalated', 'blocked', 'generation_failed', 'system_error'));

CREATE TABLE IF NOT EXISTS unit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  message      TEXT NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_units_campaign_id ON units(campaign_id);
CREATE INDEX IF NOT EXISTS idx_unit_events_unit_id ON unit_events(unit_id);
CREATE INDEX IF NOT EXISTS idx_seams_repo_id ON seams(repo_id);

-- GitHub OAuth sessions (auth/session.py). session_id is the opaque value
-- carried in the mf_session HttpOnly cookie; access/refresh tokens are
-- encrypted application-side (auth/encryption.py) before landing here, so a
-- database dump alone never yields a usable GitHub credential.
CREATE TABLE IF NOT EXISTS github_sessions (
  session_id              TEXT PRIMARY KEY,
  github_user_id          BIGINT,
  username                TEXT,
  display_name            TEXT,
  avatar_url              TEXT,
  access_token_encrypted  BYTEA NOT NULL,
  refresh_token_encrypted BYTEA,
  token_expires_at        TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_github_sessions_expires_at ON github_sessions(expires_at);
