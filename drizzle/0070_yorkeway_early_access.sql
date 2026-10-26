-- Campaign-specific single opt-in consent. No previous audience is imported.
CREATE TABLE yorkeway_early_access (
  email TEXT PRIMARY KEY NOT NULL,
  id TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'withdrawn')),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  withdrawal_hash TEXT NOT NULL UNIQUE,
  withdrawn_at TEXT
);
CREATE INDEX yorkeway_early_access_status_idx ON yorkeway_early_access(status, email);
