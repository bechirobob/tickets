CREATE TABLE analytics_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reset_key TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL
);
-- The separately authorized, one-time reset is one atomic INSERT. Bookings,
-- attendance, contacts, payments and audit evidence are never deleted.
CREATE TRIGGER analytics_baseline_clear_counters AFTER INSERT ON analytics_baseline
BEGIN
  DELETE FROM product_metrics_daily;
  UPDATE delivery_events SET status = 'suppressed', payload_json = NULL, next_attempt_at = NULL,
    updated_at = NEW.started_at
    WHERE kind = 'organizer_report' AND status IN ('queued','failed') AND created_at < NEW.started_at;
END;
