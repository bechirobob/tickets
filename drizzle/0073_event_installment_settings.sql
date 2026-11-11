-- Opt-in only: no event is enabled by this migration.
CREATE TABLE event_installment_settings (
 event_slug TEXT PRIMARY KEY NOT NULL REFERENCES curated_event_records(slug),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 step_minor INTEGER NOT NULL CHECK(typeof(step_minor)='integer' AND step_minor>0 AND step_minor<=9007199254740991),
 provider TEXT NOT NULL DEFAULT 'seevplus' CHECK(provider='seevplus'),
 updated_at TEXT NOT NULL
);
