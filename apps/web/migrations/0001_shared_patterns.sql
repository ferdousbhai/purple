PRAGMA foreign_keys = ON;

CREATE TABLE shared_patterns (
  id TEXT PRIMARY KEY CHECK (length(id) = 12),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 30000),
  created_at INTEGER NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
  dislikes INTEGER NOT NULL DEFAULT 0 CHECK (dislikes >= 0),
  score INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
);

CREATE TABLE pattern_votes (
  pattern_id TEXT NOT NULL REFERENCES shared_patterns(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pattern_id, voter_hash)
);

CREATE INDEX shared_patterns_fresh
  ON shared_patterns (created_at DESC, id DESC)
  WHERE hidden = 0;

CREATE INDEX shared_patterns_top
  ON shared_patterns (score DESC, likes DESC, created_at DESC, id DESC)
  WHERE hidden = 0;

