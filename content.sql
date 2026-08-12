CREATE TABLE IF NOT EXISTS content_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  story_key TEXT,
  title TEXT,
  source TEXT,
  category TEXT,
  link TEXT,
  published_at TEXT,
  feed_mode TEXT,
  dwell_ms INTEGER DEFAULT 0,
  target_ms INTEGER DEFAULT 0,
  origin TEXT,
  direction INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  manual_skip INTEGER DEFAULT 0,
  value_num REAL DEFAULT 0,
  value_text TEXT,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_time ON content_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_story_time ON content_events(story_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_source_time ON content_events(source, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_category_time ON content_events(category, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_type_time ON content_events(event_type, occurred_at);
