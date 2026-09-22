CREATE TABLE event_coupons (
 id TEXT PRIMARY KEY NOT NULL, event_slug TEXT NOT NULL, code TEXT NOT NULL,
 ticket_tier_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
 value INTEGER NOT NULL CHECK(value>0), max_uses INTEGER NOT NULL CHECK(max_uses>0),
 starts_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(event_slug,code)
);
CREATE INDEX event_coupons_scope ON event_coupons(event_slug,status,expires_at);
ALTER TABLE orders ADD COLUMN coupon_id TEXT;
ALTER TABLE orders ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN promoter_commission_bps INTEGER NOT NULL DEFAULT 0;
CREATE INDEX orders_coupon_usage ON orders(coupon_id,status,reservation_expires_at);
ALTER TABLE event_promoter_codes ADD COLUMN commission_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_promoter_codes ADD COLUMN portal_token_hash TEXT;
ALTER TABLE event_promoter_codes ADD COLUMN portal_expires_at TEXT;
CREATE UNIQUE INDEX promoter_portal_token ON event_promoter_codes(portal_token_hash);
CREATE TABLE promoter_payments (
 id TEXT PRIMARY KEY NOT NULL, promoter_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 reference TEXT NOT NULL, paid_at TEXT NOT NULL, recorded_by TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(promoter_id,reference)
);
CREATE INDEX promoter_payments_scope ON promoter_payments(promoter_id,paid_at);
CREATE TABLE organizer_team_invites (
 id TEXT PRIMARY KEY NOT NULL, event_slug TEXT NOT NULL, account_id TEXT NOT NULL,
 account_email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('organizer','gate')),
 token_hash TEXT NOT NULL UNIQUE, invited_by TEXT NOT NULL, created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, claim_id TEXT
);
CREATE INDEX organizer_team_scope ON organizer_team_invites(event_slug,account_id,created_at);
CREATE TABLE organizer_mutations (
 id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, event_slug TEXT NOT NULL,
 kind TEXT NOT NULL, payload_hash TEXT NOT NULL, result_id TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE curated_event_records ADD COLUMN organizer_owner_id TEXT;
CREATE INDEX event_organizer_owner ON curated_event_records(organizer_owner_id);
