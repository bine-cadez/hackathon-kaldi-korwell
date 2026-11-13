-- Slack channel archive. Full-text only: no embeddings and no Vectorize.
-- unicode61 remove_diacritics 2 folds č/š/ž onto c/s/z in rows and queries.
-- This file does not alter `documents`. It can apply before or after
-- migrations/0002_document_search.sql.
-- Deleted messages stay in slack_messages and are removed from the FTS index.

CREATE TABLE IF NOT EXISTS slack_channels (
  channel_id TEXT PRIMARY KEY,
  team_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_users (
  user_id TEXT PRIMARY KEY,
  team_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  real_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_messages (
  channel_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  team_id TEXT,
  channel_name TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  user_display_name TEXT NOT NULL DEFAULT '',
  user_real_name TEXT NOT NULL DEFAULT '',
  thread_ts TEXT,
  reply_count INTEGER,
  text TEXT NOT NULL DEFAULT '',
  edited_at TEXT,
  edit_history TEXT NOT NULL DEFAULT '[]',
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  subtype TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  bot_id TEXT,
  mentions TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  files TEXT NOT NULL DEFAULT '[]',
  permalink TEXT,
  raw_event TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_user ON slack_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_slack_messages_thread ON slack_messages (channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_slack_messages_deleted ON slack_messages (deleted, ts);

CREATE TABLE IF NOT EXISTS slack_reactions (
  channel_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  event_ts TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (channel_id, ts, name, user_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS slack_messages_fts USING fts5(
  channel_id UNINDEXED,
  ts UNINDEXED,
  body,
  user_name,
  channel_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS slack_messages_fts_insert
AFTER INSERT ON slack_messages
WHEN NEW.deleted = 0
BEGIN
  INSERT INTO slack_messages_fts(channel_id, ts, body, user_name, channel_name)
  VALUES (
    NEW.channel_id,
    NEW.ts,
    NEW.text,
    trim(COALESCE(NEW.user_display_name, '') || ' ' || COALESCE(NEW.user_real_name, '')),
    COALESCE(NEW.channel_name, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS slack_messages_fts_update_live
AFTER UPDATE ON slack_messages
WHEN NEW.deleted = 0
BEGIN
  DELETE FROM slack_messages_fts WHERE channel_id = OLD.channel_id AND ts = OLD.ts;
  INSERT INTO slack_messages_fts(channel_id, ts, body, user_name, channel_name)
  VALUES (
    NEW.channel_id,
    NEW.ts,
    NEW.text,
    trim(COALESCE(NEW.user_display_name, '') || ' ' || COALESCE(NEW.user_real_name, '')),
    COALESCE(NEW.channel_name, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS slack_messages_fts_update_deleted
AFTER UPDATE ON slack_messages
WHEN NEW.deleted = 1
BEGIN
  DELETE FROM slack_messages_fts WHERE channel_id = OLD.channel_id AND ts = OLD.ts;
END;

CREATE TRIGGER IF NOT EXISTS slack_messages_fts_delete
AFTER DELETE ON slack_messages
BEGIN
  DELETE FROM slack_messages_fts WHERE channel_id = OLD.channel_id AND ts = OLD.ts;
END;
