-- OFFLINE SQLite only. Not approved for live D1 deployment.
-- Sketches hold keyed digests of visitor IDs, so they remain private analytical data.
CREATE TABLE IF NOT EXISTS ad_reach_hourly (
  hour_start INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global','ad','facet')),
  ad_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('view','return')),
  dimension TEXT NOT NULL DEFAULT 'all',
  dimension_value TEXT NOT NULL DEFAULT '',
  key_id TEXT NOT NULL,
  reach BLOB NOT NULL,
  PRIMARY KEY (hour_start,scope,ad_id,kind,dimension,dimension_value)
);
CREATE INDEX IF NOT EXISTS idx_ad_reach_lookup ON ad_reach_hourly(scope,ad_id,kind,dimension,hour_start);
CREATE TABLE IF NOT EXISTS ad_reach_batches (
  batch_id TEXT PRIMARY KEY,
  payload_mac TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
