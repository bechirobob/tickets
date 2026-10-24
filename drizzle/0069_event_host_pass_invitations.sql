-- No backfill, pass, token or email. Owner provision and send are separate actions.
CREATE TABLE event_host_pass_invitations (
 id TEXT PRIMARY KEY,
 event_slug TEXT NOT NULL,
 host_account_id TEXT NOT NULL,
 recipient_email TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 provision_nonce TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 reused INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'provisioned',
 token_hash TEXT,
 expires_at TEXT,
 used_at TEXT,
 claimed_session_id TEXT,
 delivery_id TEXT
);
CREATE UNIQUE INDEX event_host_pass_scope_unique ON event_host_pass_invitations(event_slug,host_account_id);
CREATE UNIQUE INDEX event_host_pass_invitations_token_hash_unique ON event_host_pass_invitations(token_hash);
