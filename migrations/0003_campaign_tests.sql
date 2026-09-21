CREATE TABLE campaign_tests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  content_json TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('uk', 'en', 'pl')),
  mode TEXT NOT NULL CHECK (mode IN ('real', 'fast')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'cancelled')),
  step INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  UNIQUE(owner_id, request_key)
);
CREATE UNIQUE INDEX one_active_campaign_test ON campaign_tests(owner_id) WHERE state = 'active';
CREATE TABLE campaign_test_deliveries (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES campaign_tests(id),
  step INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL DEFAULT 0,
  message_id INTEGER,
  sent_at INTEGER,
  UNIQUE(test_id, step)
);
CREATE INDEX campaign_test_dispatch ON campaign_test_deliveries(state, available_at, enqueued_at);
