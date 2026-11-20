-- OFFLINE SQLite prototype. Never apply directly to a live Cloudflare D1 database.
-- All aggregates and the keyed event ledger are committed in one SQLite transaction.
CREATE TABLE IF NOT EXISTS v2_event_ledger (
 event_mac TEXT PRIMARY KEY, payload_mac TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_event_time ON v2_event_ledger(occurred_at);
CREATE TABLE IF NOT EXISTS v2_key_config (
 id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL, fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_batch_manifest (
 batch_id TEXT PRIMARY KEY, payload_mac TEXT NOT NULL, newly_accepted INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_watermark (
 id INTEGER PRIMARY KEY CHECK (id=1),
 day_sealed_before INTEGER NOT NULL DEFAULT 0,
 month_sealed_before INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO v2_watermark(id) VALUES(1);
CREATE TABLE IF NOT EXISTS v2_counters (
 grain TEXT NOT NULL CHECK(grain IN ('hour','day','month')),
 bucket_start INTEGER NOT NULL,
 ad_id TEXT NOT NULL, device_type TEXT NOT NULL, orientation TEXT NOT NULL,
 local_hour INTEGER NOT NULL,
 views INTEGER NOT NULL DEFAULT 0, skips INTEGER NOT NULL DEFAULT 0,
 completes INTEGER NOT NULL DEFAULT 0, returns INTEGER NOT NULL DEFAULT 0,
 repeat_views INTEGER NOT NULL DEFAULT 0,
 dwell_sum_ms INTEGER NOT NULL DEFAULT 0, dwell_count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(grain,bucket_start,ad_id,device_type,orientation,local_hour)
);
CREATE INDEX IF NOT EXISTS idx_v2_counters_time ON v2_counters(grain,bucket_start);
CREATE TABLE IF NOT EXISTS v2_reach (
 grain TEXT NOT NULL CHECK(grain IN ('hour','day','month')),
 bucket_start INTEGER NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('global','ad','facet')),
 ad_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('view','return')),
 dimension TEXT NOT NULL, dimension_value TEXT NOT NULL,
 key_id TEXT NOT NULL, reach BLOB NOT NULL,
 PRIMARY KEY(grain,bucket_start,scope,ad_id,kind,dimension,dimension_value)
);
CREATE INDEX IF NOT EXISTS idx_v2_reach_time ON v2_reach(grain,bucket_start);
