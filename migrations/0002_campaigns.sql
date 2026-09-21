ALTER TABLE users ADD COLUMN last_delivery_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE user_ordinals (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id)
);
INSERT INTO user_ordinals(user_id) SELECT id FROM users ORDER BY first_seen_at, id;

CREATE TABLE campaigns (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('sequence', 'broadcast')),
  title TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  current_version TEXT,
  published_at INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE campaign_versions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  revision INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE(campaign_id, revision)
);
CREATE TABLE campaign_drafts (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  nonce TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_json TEXT NOT NULL
);
CREATE TABLE enrollments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  version_id TEXT NOT NULL REFERENCES campaign_versions(id),
  kind TEXT NOT NULL CHECK (kind IN ('sequence', 'broadcast')),
  step INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'converted', 'cancelled')),
  UNIQUE(user_id, campaign_id)
);
CREATE UNIQUE INDEX one_active_sequence ON enrollments(user_id) WHERE kind = 'sequence' AND state = 'active';
CREATE INDEX enrollment_due ON enrollments(state, due_at);
CREATE TABLE broadcast_runs (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id),
  cutoff INTEGER NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
  step INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL DEFAULT 0,
  message_id INTEGER,
  UNIQUE(enrollment_id, step)
);
CREATE INDEX delivery_dispatch ON deliveries(state, available_at, enqueued_at);
