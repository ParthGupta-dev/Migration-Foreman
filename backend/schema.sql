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
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'failed', 'retrying', 'escalated')) DEFAULT 'pending',
  attempt      INTEGER NOT NULL DEFAULT 0,
  diff         TEXT,
  failure_log  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
