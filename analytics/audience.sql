CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  last_ip TEXT,
  last_country TEXT,
  last_city TEXT,
  last_region TEXT,
  last_asn INTEGER DEFAULT 0,
  last_as_org TEXT,
  last_device_type TEXT,
  last_browser TEXT,
  last_os TEXT,
  last_language TEXT,
  last_timezone TEXT,
  last_user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitors_first ON visitors(first_seen);
CREATE INDEX IF NOT EXISTS idx_visitors_last ON visitors(last_seen);
CREATE INDEX IF NOT EXISTS idx_visitors_country ON visitors(last_country);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ended_at INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  story_views INTEGER DEFAULT 0,
  referrer TEXT,
  page TEXT,
  language TEXT,
  languages_json TEXT,
  timezone TEXT,
  user_agent TEXT,
  platform TEXT,
  browser TEXT,
  os TEXT,
  device_type TEXT,
  screen_w INTEGER DEFAULT 0,
  screen_h INTEGER DEFAULT 0,
  viewport_w INTEGER DEFAULT 0,
  viewport_h INTEGER DEFAULT 0,
  dpr REAL DEFAULT 1,
  color_depth INTEGER DEFAULT 0,
  hardware_concurrency INTEGER DEFAULT 0,
  device_memory REAL DEFAULT 0,
  touch_points INTEGER DEFAULT 0,
  connection_type TEXT,
  downlink REAL DEFAULT 0,
  rtt REAL DEFAULT 0,
  save_data INTEGER DEFAULT 0,
  cookies_enabled INTEGER DEFAULT 0,
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  region_code TEXT,
  continent TEXT,
  latitude TEXT,
  longitude TEXT,
  postal_code TEXT,
  timezone_cf TEXT,
  colo TEXT,
  asn INTEGER DEFAULT 0,
  as_org TEXT,
  tls_version TEXT,
  http_protocol TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_type);
