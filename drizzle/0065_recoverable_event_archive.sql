-- A reversible display archive. Do not reuse removed_at: removal destroys data.
ALTER TABLE curated_event_records ADD COLUMN archived_at TEXT;
CREATE INDEX curated_event_archive_idx ON curated_event_records(archived_at, starts_at);
