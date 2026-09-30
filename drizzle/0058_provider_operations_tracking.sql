CREATE TABLE `provider_operation_records` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL REFERENCES `orders`(`id`),
  `provider` text NOT NULL CHECK (`provider` IN ('paystack', 'seevplus')),
  `kind` text NOT NULL CHECK (`kind` IN ('refund', 'settlement')),
  `status` text NOT NULL CHECK (`status` IN ('pending', 'completed', 'closed_unpaid')),
  `version` integer NOT NULL CHECK (`version` > 0),
  `case_reference` text NOT NULL,
  `amount_minor` integer,
  `currency` text NOT NULL,
  `evidence_at` text,
  `recorded_by` text NOT NULL,
  `recorded_at` text NOT NULL,
  CHECK ((`kind` = 'refund' AND `amount_minor` IS NOT NULL AND `amount_minor` > 0) OR (`kind` = 'settlement' AND `amount_minor` IS NULL)),
  CHECK ((`status` = 'completed' AND `evidence_at` IS NOT NULL) OR (`status` IN ('pending','closed_unpaid') AND `evidence_at` IS NULL)),
  CHECK (`status` <> 'closed_unpaid' OR `kind` = 'refund')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_operation_version_unique` ON `provider_operation_records` (`order_id`, `kind`, `version`);
--> statement-breakpoint
CREATE INDEX `provider_operation_order_idx` ON `provider_operation_records` (`order_id`, `kind`, `recorded_at`);
--> statement-breakpoint
-- Old application binaries also reserve a refund before contacting Paystack.
-- Preserve this invariant on rollback while allowing failed-preflight audit rows.
CREATE TRIGGER provider_refund_reservation_guard
BEFORE INSERT ON payment_refunds
WHEN NEW.status IN ('pending','processing') AND EXISTS (
  SELECT 1 FROM provider_operation_records r
  WHERE r.order_id=NEW.order_id AND r.kind='refund' AND (
    r.status='completed' OR (r.status='pending' AND NOT EXISTS (
      SELECT 1 FROM provider_operation_records n
      WHERE n.order_id=r.order_id AND n.kind=r.kind AND n.version>r.version
    ))
  )
)
BEGIN
  SELECT RAISE(ABORT, 'An external refund case requires provider review before another refund.');
END;
