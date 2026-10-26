-- Campaign-specific, verified consent. No existing audience is imported.
CREATE TABLE yorkeway_early_access (
  email TEXT PRIMARY KEY NOT NULL,
  guest_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'subscribed', 'withdrawn')),
  revision INTEGER NOT NULL DEFAULT 1,
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  verified_at TEXT,
  withdrawn_at TEXT,
  confirmed_grant TEXT
);
CREATE INDEX yorkeway_early_access_status_idx ON yorkeway_early_access(status, email);
CREATE TABLE yorkeway_signup_grants (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL REFERENCES yorkeway_early_access(email),
  guest_name TEXT NOT NULL,
  subscription_revision INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  withdrawal_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX yorkeway_signup_grants_email_idx ON yorkeway_signup_grants(email, created_at);
