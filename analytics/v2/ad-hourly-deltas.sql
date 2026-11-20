-- OFFLINE STAGING PROTOTYPE ONLY. Do not run against production D1.
-- Append-only aggregate delta: one row per unique (batch, UTC hour, ad, device, orientation, local hour).
-- The batch ID must be stable across retries. Global event-ID deduplication is upstream.
CREATE TABLE IF NOT EXISTS ad_hourly_deltas (
  batch_id TEXT NOT NULL,
  hour_start INTEGER NOT NULL,
  ad_id TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT '',
  orientation TEXT NOT NULL DEFAULT '',
  local_hour INTEGER NOT NULL DEFAULT -1,
  views INTEGER NOT NULL DEFAULT 0,
  skips INTEGER NOT NULL DEFAULT 0,
  completes INTEGER NOT NULL DEFAULT 0,
  returns INTEGER NOT NULL DEFAULT 0,
  repeat_views INTEGER NOT NULL DEFAULT 0,
  dwell_sum_ms INTEGER NOT NULL DEFAULT 0,
  dwell_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, hour_start, ad_id, device_type, orientation, local_hour)
);
CREATE INDEX IF NOT EXISTS idx_ad_hourly_deltas_hour ON ad_hourly_deltas(hour_start, ad_id);
CREATE INDEX IF NOT EXISTS idx_ad_hourly_deltas_ad_hour ON ad_hourly_deltas(ad_id, hour_start);
