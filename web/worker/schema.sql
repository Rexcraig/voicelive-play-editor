-- Community presets (Cloudflare D1). Apply with:
--   npx wrangler d1 execute vlp-community --remote --file worker/schema.sql     (from web/)
-- Safe to re-run: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS presets (
  id           TEXT PRIMARY KEY,          -- random, 12 chars, also used in share links
  name         TEXT NOT NULL,             -- as the pedal stores it (pedal name rule applied)
  tags         INTEGER NOT NULL,          -- the pedal's 28-bit genre bits
  params       TEXT NOT NULL,             -- JSON array of the 50 values
  fingerprint  TEXT NOT NULL,             -- sha-256 of the values, for duplicate checks
  description  TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL,             -- display name, public
  author_email TEXT NOT NULL,             -- from Cloudflare Access, never sent to other users
  created_at   INTEGER NOT NULL,          -- unix ms
  hidden       INTEGER NOT NULL DEFAULT 0 -- 1 = removed by a moderator
);
CREATE INDEX IF NOT EXISTS presets_created ON presets (created_at DESC);
CREATE INDEX IF NOT EXISTS presets_author ON presets (author_email, created_at);
CREATE INDEX IF NOT EXISTS presets_fingerprint ON presets (fingerprint);

CREATE TABLE IF NOT EXISTS reports (
  preset_id      TEXT NOT NULL,
  reporter_email TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (preset_id, reporter_email)  -- one report per person per preset
);

-- Every share, kept when presets are deleted, so the daily limit can't be reset by deleting.
CREATE TABLE IF NOT EXISTS share_log (
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS share_log_email ON share_log (email, created_at);

-- People a moderator has stopped from sharing.
CREATE TABLE IF NOT EXISTS banned (
  email      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
