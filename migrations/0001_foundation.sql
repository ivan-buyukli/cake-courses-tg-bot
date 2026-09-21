CREATE TABLE users (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL UNIQUE,
  identity_cipher TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('uk', 'en', 'pl')),
  locale_explicit INTEGER NOT NULL DEFAULT 0 CHECK (locale_explicit IN (0, 1)),
  locale_event_at INTEGER NOT NULL DEFAULT 0,
  locale_update_id INTEGER NOT NULL DEFAULT -1,
  is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  profile_event_at INTEGER NOT NULL,
  started_at INTEGER,
  opted_out INTEGER NOT NULL DEFAULT 0 CHECK (opted_out IN (0, 1)),
  preference_event_at INTEGER NOT NULL DEFAULT 0,
  preference_update_id INTEGER NOT NULL DEFAULT -1,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  reachability_event_at INTEGER NOT NULL DEFAULT 0,
  purchase_suppressed INTEGER NOT NULL DEFAULT 0 CHECK (purchase_suppressed IN (0, 1)),
  payment_status TEXT NOT NULL DEFAULT 'unknown' CHECK (payment_status IN ('unknown', 'unpaid', 'pending', 'paid', 'refunded', 'disputed'))
);
CREATE INDEX users_pagination ON users(first_seen_at, id);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('processing', 'done')),
  lease_token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  bot_key TEXT NOT NULL,
  file_unique_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  file_id_cipher TEXT NOT NULL,
  file_size INTEGER,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  duration INTEGER,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'needs_upload')),
  created_at INTEGER NOT NULL,
  validated_at INTEGER,
  UNIQUE(bot_key, file_unique_id, media_type)
);
CREATE INDEX media_pagination ON media_assets(created_at, id);

CREATE TABLE admin_uploads (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_id TEXT,
  created_at INTEGER NOT NULL
);
