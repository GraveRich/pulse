-- Pulse accounts (Cloudflare D1). Apply with:  wrangler d1 execute pulse-accounts --remote --file schema.sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,       -- pbkdf2$rounds$salt$hash
  recovery TEXT NOT NULL,   -- sha256 of the recovery code
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,   -- sha256 of the session token the app holds
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS libraries (
  user_id INTEGER PRIMARY KEY,
  rev INTEGER NOT NULL,     -- goes up by one on every save
  updated INTEGER NOT NULL,
  data TEXT NOT NULL        -- JSON: liked songs, playlists, saved SoundCloud pages
);
-- rate limiting (keys are hashes, never raw IP addresses)
CREATE TABLE IF NOT EXISTS rl (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset INTEGER NOT NULL
);
