CREATE TABLE IF NOT EXISTS behavior_events (
  event_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  story_key TEXT,
  source TEXT,
  category TEXT,
  feed_mode TEXT,
  keyword_text TEXT,
  keyword_count INTEGER DEFAULT 0,
  mode TEXT,
  value_num REAL DEFAULT 0,
  value_text TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_behavior_time ON behavior_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_type_time ON behavior_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_session_time ON behavior_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_visitor_time ON behavior_events(visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_keyword_time ON behavior_events(keyword_text, occurred_at);
