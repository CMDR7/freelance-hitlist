-- FL-HL V2.9 initial persistence schema
-- Apply with Wrangler D1 migrations after reviewing the database binding.
-- Storage schema only: this migration does not alter acquisition or deploy triggers.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  scheduled_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  rss_sources_checked INTEGER NOT NULL DEFAULT 0,
  rss_sources_healthy INTEGER NOT NULL DEFAULT 0,
  api_sources_checked INTEGER NOT NULL DEFAULT 0,
  api_sources_healthy INTEGER NOT NULL DEFAULT 0,
  candidates_acquired INTEGER NOT NULL DEFAULT 0,
  candidates_normalized INTEGER NOT NULL DEFAULT 0,
  candidates_rejected INTEGER NOT NULL DEFAULT 0,
  unique_opportunities INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  returned_opportunities INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS source_health (
  run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'api')),
  source_name TEXT NOT NULL,
  endpoint TEXT,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'empty', 'degraded', 'timeout', 'invalid')),
  http_status INTEGER,
  latency_ms INTEGER,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY (run_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_source_health_source_checked ON source_health(source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  canonical_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  employer TEXT NOT NULL,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  published_at TEXT,
  updated_at TEXT,
  retrieved_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  freshness TEXT NOT NULL CHECK (freshness IN ('fresh', 'stale', 'unknown')),
  location_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  engagement_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  attribution_json TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  record_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  region_text TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_run_id TEXT REFERENCES pipeline_runs(run_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_opportunities_published ON opportunities(published_at DESC, canonical_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_source ON opportunities(source_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_freshness ON opportunities(freshness, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_last_seen_run ON opportunities(last_seen_run_id);

CREATE TABLE IF NOT EXISTS pipeline_run_opportunities (
  run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
  canonical_id TEXT NOT NULL REFERENCES opportunities(canonical_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'api')),
  PRIMARY KEY (run_id, canonical_id),
  UNIQUE (run_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_run_opportunities_page ON pipeline_run_opportunities(run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_run_opportunities_source ON pipeline_run_opportunities(run_id, source_type, source_id, ordinal);

CREATE TABLE IF NOT EXISTS latest_payload (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id),
  generated_at TEXT NOT NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pipeline_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
