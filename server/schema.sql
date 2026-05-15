-- HTML basics test Postgres schema.
-- The server creates this automatically on startup; this file exists so you can
-- run it manually in Neon's SQL editor if you want to inspect or pre-create.

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  participant_label TEXT,
  client_submitted_at TIMESTAMPTZ,
  user_agent TEXT,
  answers JSONB NOT NULL,
  graded JSONB NOT NULL,
  score_total INTEGER NOT NULL,
  score_max INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_received_at_idx
  ON submissions (received_at DESC);
