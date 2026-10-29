CREATE TABLE IF NOT EXISTS submissions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  base_revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_applied_revision ON submissions(applied, revision);
