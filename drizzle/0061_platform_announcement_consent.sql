-- Separate, explicit BeCore Tickets consent. Existing event/host permission is
-- intentionally not copied or changed, and no provider contacts are imported.
CREATE TABLE platform_announcement_subscriptions (
  email TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
  consent_version TEXT NOT NULL,
  consented_at TEXT,
  verified_at TEXT,
  unsubscribed_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('rsvp', 'checkout', 'preferences', 'unsubscribe')),
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX platform_announcement_status_idx ON platform_announcement_subscriptions(status, email);

-- source/source_id is an immutable submission receipt: a replay can never
-- convert the original unchecked choice, refresh consent or clear suppression.
CREATE TABLE platform_announcement_choices (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('rsvp', 'checkout', 'preferences', 'unsubscribe', 'verification')),
  source_id TEXT NOT NULL,
  opted_in INTEGER NOT NULL CHECK (opted_in IN (0, 1)),
  verified_email INTEGER NOT NULL CHECK (verified_email IN (0, 1)),
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX platform_announcement_choices_email_idx ON platform_announcement_choices(email, created_at);

-- Capabilities are revoke-only and hashed at rest. No arbitrary expiry: a token
-- remains valid for its consent revision until that subscription changes.
CREATE TABLE platform_announcement_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  subscription_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX platform_announcement_tokens_email_idx ON platform_announcement_unsubscribe_tokens(email, subscription_revision);

-- Proof may finalize only the exact pending choice that the emailed link named.
-- Existing recovery links have no binding and cannot activate announcements.
CREATE TABLE platform_announcement_verifications (
  grant_type TEXT NOT NULL CHECK (grant_type IN ('recovery', 'registration')),
  grant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  subscription_revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  PRIMARY KEY (grant_type, grant_id)
);
