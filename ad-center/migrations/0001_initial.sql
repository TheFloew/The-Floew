CREATE TABLE IF NOT EXISTS ads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  media_key TEXT NOT NULL,
  media_name TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  media_content_type TEXT NOT NULL,
  media_size INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_ads_schedule
  ON ads (is_enabled, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_ads_chronology
  ON ads (start_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS login_throttle (
  ip_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
