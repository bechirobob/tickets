-- Additive, dormant foundation. No live order/event configuration is changed.
-- Amounts are gross booking credits in pesewas, never provider settlement net.
CREATE TABLE installment_plans (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id),
  buyer_email TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider='seevplus'),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  settlement_snapshot_json TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency='GHS'),
  total_minor INTEGER NOT NULL CHECK(typeof(total_minor)='integer' AND total_minor>0),
  step_minor INTEGER NOT NULL CHECK(typeof(step_minor)='integer' AND step_minor>0),
  created_at TEXT NOT NULL
);
CREATE TRIGGER installment_plan_matches_order BEFORE INSERT ON installment_plans BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id
   AND o.customer_email=NEW.buyer_email AND o.total_amount_minor=NEW.total_minor
   AND o.currency=NEW.currency AND o.payment_provider=NEW.provider
   AND o.payment_environment=NEW.environment AND o.status='payment_pending')
 THEN RAISE(ABORT,'installment plan must match its booking') END;
END;
CREATE TRIGGER installment_plan_immutable BEFORE UPDATE ON installment_plans BEGIN
 SELECT RAISE(ABORT,'installment plan is immutable');
END;
CREATE TABLE installment_charges (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES installment_plans(order_id),
  idempotency_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
  provider_reference TEXT,
  provider_transaction_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','closed_unpaid','review')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
-- A timeout does NOT close a charge: its provider outcome must be reconciled.
CREATE INDEX installment_booking_history ON installment_charges(order_id,state,created_at);
CREATE UNIQUE INDEX installment_one_unresolved ON installment_charges(order_id) WHERE state IN ('pending','review');
CREATE UNIQUE INDEX installment_provider_reference ON installment_charges(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX installment_provider_transaction ON installment_charges(provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE TRIGGER installment_charge_insert BEFORE INSERT ON installment_charges BEGIN
 SELECT CASE WHEN NEW.state<>'pending' OR NEW.provider_transaction_id IS NOT NULL OR NEW.confirmed_at IS NOT NULL
 THEN RAISE(ABORT,'charges must start pending') END;
 SELECT CASE WHEN NEW.amount_minor>COALESCE((SELECT p.total_minor-COALESCE((SELECT SUM(c.amount_minor) FROM installment_charges c WHERE c.order_id=p.order_id AND c.state='confirmed'),0) FROM installment_plans p WHERE p.order_id=NEW.order_id),0)
 THEN RAISE(ABORT,'charge exceeds remaining balance') END;
END;
CREATE TRIGGER installment_charge_update BEFORE UPDATE ON installment_charges BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.order_id<>OLD.order_id OR NEW.amount_minor<>OLD.amount_minor
 OR NEW.idempotency_hash<>OLD.idempotency_hash OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
 OR (OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS NOT OLD.provider_reference)
 OR (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS NOT OLD.provider_transaction_id)
 THEN RAISE(ABORT,'charge identity is immutable') END;
 SELECT CASE WHEN OLD.state IN ('confirmed','closed_unpaid') AND (NEW.state<>OLD.state OR NEW.confirmed_at IS NOT OLD.confirmed_at)
 THEN RAISE(ABORT,'terminal charge needs reconciliation') END;
 SELECT CASE WHEN NEW.state='confirmed' AND (NEW.provider_reference IS NULL OR NEW.provider_transaction_id IS NULL OR NEW.confirmed_at IS NULL)
 THEN RAISE(ABORT,'verified provider identity required') END;
 SELECT CASE WHEN NEW.state='confirmed' AND NEW.amount_minor>COALESCE((SELECT p.total_minor-COALESCE((SELECT SUM(c.amount_minor) FROM installment_charges c WHERE c.order_id=p.order_id AND c.id<>NEW.id AND c.state='confirmed'),0) FROM installment_plans p WHERE p.order_id=NEW.order_id),0)
 THEN RAISE(ABORT,'confirmed amount exceeds balance') END;
END;
CREATE TRIGGER installment_charge_no_delete BEFORE DELETE ON installment_charges BEGIN
 SELECT RAISE(ABORT,'payment history cannot be deleted');
END;
CREATE TABLE installment_checkout_sessions (
 charge_id TEXT PRIMARY KEY NOT NULL REFERENCES installment_charges(id),
 request_json TEXT NOT NULL,
 checkout_url TEXT,
 created_at TEXT NOT NULL,
 checked_at TEXT,
 lease_until TEXT,
 last_error TEXT
);
CREATE TRIGGER installment_session_request_immutable BEFORE UPDATE ON installment_checkout_sessions
WHEN NEW.charge_id<>OLD.charge_id OR NEW.request_json<>OLD.request_json OR NEW.created_at<>OLD.created_at BEGIN
 SELECT RAISE(ABORT,'checkout identity is immutable');
END;
