CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  data TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL
);
-- Each player's best checked score per ranked mode: ms for marathon, lines for survival
CREATE TABLE IF NOT EXISTS records (
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX IF NOT EXISTS records_rank ON records (mode, score);
