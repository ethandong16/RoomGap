CREATE TABLE IF NOT EXISTS admin_trusted_devices (
  device_id TEXT PRIMARY KEY NOT NULL,
  secret_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_trusted_devices_expires_at_idx ON admin_trusted_devices(expires_at);
