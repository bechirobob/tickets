ALTER TABLE party_submissions ADD COLUMN organizer_access_pending INTEGER NOT NULL DEFAULT 0;
CREATE TABLE organizer_invitations (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  account_email TEXT NOT NULL,
  account_password_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  claim_id TEXT UNIQUE
);
CREATE INDEX party_submissions_access_pending_idx ON party_submissions(organizer_access_pending);
