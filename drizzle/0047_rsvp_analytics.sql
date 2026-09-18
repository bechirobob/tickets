ALTER TABLE event_registrations ADD acquisition_source text NOT NULL DEFAULT 'untracked';
CREATE INDEX registrations_analytics_idx ON event_registrations(event_slug, kind, created_at);
