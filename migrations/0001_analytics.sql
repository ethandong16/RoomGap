CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'query', 'room_detail', 'theme_change')),
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_query_periods (
  event_id TEXT NOT NULL REFERENCES analytics_events(id) ON DELETE CASCADE,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 13),
  PRIMARY KEY (event_id, period)
);

CREATE INDEX IF NOT EXISTS analytics_query_periods_period_idx ON analytics_query_periods(period);
