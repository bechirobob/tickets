import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const bookingFeeRules = sqliteTable("booking_fee_rules", {
  id: text("id").primaryKey(),
  percentageBasisPoints: integer("percentage_basis_points").notNull(),
  scope: text("scope", { enum: ["global", "event", "organizer"] }).notNull(),
  scopeId: text("scope_id"),
  effectiveAt: text("effective_at").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [index("booking_fee_scope_idx").on(table.scope, table.scopeId, table.effectiveAt)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull(),
  eventSlug: text("event_slug").notNull(),
  ticketType: text("ticket_type").notNull().default("general"),
  quantity: integer("quantity").notNull(),
  faceAmountMinor: integer("face_amount_minor").notNull(),
  bookingFeeMinor: integer("booking_fee_minor").notNull(),
  totalAmountMinor: integer("total_amount_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  paymentChannel: text("payment_channel").notNull(),
  status: text("status", { enum: ["payment_pending", "paid", "failed", "refund_pending", "refunded", "expired", "requires_refund", "disputed"] }).notNull(),
  paystackReference: text("paystack_reference"),
  paystackTransactionId: text("paystack_transaction_id"),
  paystackStatus: text("paystack_status"),
  ticketTierId: text("ticket_tier_id"),
  unitQuantity: integer("unit_quantity").notNull().default(1),
  reservationExpiresAt: text("reservation_expires_at"),
  paymentUpdatedAt: text("payment_updated_at"),
  paymentVerifiedAt: text("payment_verified_at"),
  failureReason: text("failure_reason"),
  refundStatus: text("refund_status"),
  refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
  disputeStatus: text("dispute_status"),
  createdAt: text("created_at").notNull(),
  paidAt: text("paid_at"),
}, (table) => [
  uniqueIndex("orders_reference_unique").on(table.reference),
  index("orders_event_status_idx").on(table.eventSlug, table.status),
]);

export const attendeeProfiles = sqliteTable("attendee_profiles", {
  id: text("id").primaryKey(),
  normalizedEmail: text("normalized_email").notNull(),
  phone: text("phone"),
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("attendee_profiles_email_unique").on(table.normalizedEmail)]);

export const attendeeSessions = sqliteTable("attendee_sessions", {
  id: text("id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("attendee_sessions_token_unique").on(table.tokenHash),
  index("attendee_sessions_attendee_idx").on(table.attendeeId, table.expiresAt),
]);

export const orderAccessGrants = sqliteTable("order_access_grants", {
  orderId: text("order_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  claimedAt: text("claimed_at"),
  claimedSessionId: text("claimed_session_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("order_access_grants_token_unique").on(table.tokenHash)]);

export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  reference: text("reference").notNull(),
  receivedAt: text("received_at").notNull(),
  payloadHash: text("payload_hash").notNull(),
}, (table) => [uniqueIndex("payment_events_payload_unique").on(table.payloadHash)]);

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  ticketType: text("ticket_type").notNull(),
  admissionNumber: integer("admission_number"),
  qrTokenHash: text("qr_token_hash").notNull(),
  status: text("status", { enum: ["issued", "transferred", "checked_in", "voided", "refunded"] }).notNull(),
  issuedAt: text("issued_at").notNull(),
  checkedInAt: text("checked_in_at"),
  checkedInBy: text("checked_in_by"),
  checkedInGate: text("checked_in_gate"),
}, (table) => [
  uniqueIndex("tickets_qr_token_unique").on(table.qrTokenHash),
  uniqueIndex("tickets_order_admission_unique").on(table.orderId, table.admissionNumber),
  index("tickets_order_idx").on(table.orderId),
]);

export const ticketAssignments = sqliteTable("ticket_assignments", {
  ticketId: text("ticket_id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  assignedBy: text("assigned_by").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  assignedAt: text("assigned_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [index("ticket_assignments_attendee_idx").on(table.attendeeId, table.status)]);

export const roomReports = sqliteTable("room_reports", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  reporterAttendeeId: text("reporter_attendee_id").notNull(),
  messageId: text("message_id").notNull(),
  reason: text("reason", { enum: ["harassment", "spam", "impersonation", "unsafe", "other"] }).notNull(),
  details: text("details"),
  status: text("status", { enum: ["open", "reviewed", "actioned", "dismissed"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => [index("room_reports_event_status_idx").on(table.eventSlug, table.status, table.createdAt)]);

export const roomBlocks = sqliteTable("room_blocks", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  blockerAttendeeId: text("blocker_attendee_id").notNull(),
  blockedAttendeeId: text("blocked_attendee_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("room_blocks_pair_unique").on(table.eventSlug, table.blockerAttendeeId, table.blockedAttendeeId),
  index("room_blocks_blocker_idx").on(table.blockerAttendeeId, table.eventSlug),
]);

export const roomModerationActions = sqliteTable("room_moderation_actions", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  actor: text("actor").notNull(),
  action: text("action", { enum: ["announcement", "pin", "unpin", "remove_message", "suspend_attendee", "restore_attendee"] }).notNull(),
  messageId: text("message_id"),
  targetAttendeeId: text("target_attendee_id"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("room_moderation_event_idx").on(table.eventSlug, table.createdAt)]);

export const partySubmissions = sqliteTable("party_submissions", {
  id: text("id").primaryKey(),
  organizerName: text("organizer_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  title: text("title").notNull(),
  concept: text("concept").notNull(),
  venueName: text("venue_name").notNull(),
  venueMapUrl: text("venue_map_url"),
  area: text("area").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  vibe: text("vibe", { enum: ["Late night", "Day party", "Alté", "Amapiano"] }).notNull(),
  lineup: text("lineup").notNull(),
  capacity: integer("capacity").notNull(),
  priceFromMinor: integer("price_from_minor").notNull(),
  ageRestriction: text("age_restriction").notNull(),
  socialUrl: text("social_url"),
  posterObjectKey: text("poster_object_key"),
  posterContentType: text("poster_content_type"),
  posterData: blob("poster_data", { mode: "buffer" }),
  status: text("status", { enum: ["submitted", "in_review", "changes_requested", "approved", "rejected", "scheduled", "published", "unpublished", "archived"] }).notNull(),
  reviewNote: text("review_note"),
  curationNote: text("curation_note"),
  scheduledPublishAt: text("scheduled_publish_at"),
  publishedAt: text("published_at"),
  eventSlug: text("event_slug"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("party_submissions_status_idx").on(table.status, table.createdAt),
  uniqueIndex("party_submissions_event_slug_unique").on(table.eventSlug),
]);

export const curatedEventRecords = sqliteTable("curated_event_records", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  venue: text("venue").notNull(),
  area: text("area").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  vibe: text("vibe", { enum: ["Late night", "Day party", "Alté", "Amapiano"] }).notNull(),
  priceFromMinor: integer("price_from_minor").notNull(),
  capacity: integer("capacity").notNull().default(0),
  salesOpenAt: text("sales_open_at"),
  salesCloseAt: text("sales_close_at"),
  venueMapUrl: text("venue_map_url"),
  ageRestriction: text("age_restriction").notNull().default("18+"),
  lineup: text("lineup").notNull().default("Line-up to be announced"),
  eventState: text("event_state", { enum: ["on_sale", "sold_out", "cancelled", "postponed", "rescheduled"] }).notNull().default("on_sale"),
  rescheduledFrom: text("rescheduled_from"),
  imageUrl: text("image_url").notNull(),
  curationNote: text("curation_note").notNull(),
  status: text("status", { enum: ["scheduled", "published", "unpublished"] }).notNull(),
  scheduledPublishAt: text("scheduled_publish_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("curated_events_submission_unique").on(table.submissionId),
  uniqueIndex("curated_events_slug_unique").on(table.slug),
  index("curated_events_publication_idx").on(table.status, table.scheduledPublishAt),
]);

export const eventTicketTiers = sqliteTable("event_ticket_tiers", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceMinor: integer("price_minor").notNull(),
  admissionsPerUnit: integer("admissions_per_unit").notNull().default(1),
  capacityAdmissions: integer("capacity_admissions").notNull(),
  maxUnitsPerOrder: integer("max_units_per_order").notNull().default(10),
  status: text("status", { enum: ["available", "sold_out", "hidden"] }).notNull().default("available"),
  salesOpenAt: text("sales_open_at"),
  salesCloseAt: text("sales_close_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("event_ticket_tiers_event_code_unique").on(table.eventSlug, table.code),
  index("event_ticket_tiers_event_idx").on(table.eventSlug, table.status, table.sortOrder),
]);

export const inventoryReservations = sqliteTable("inventory_reservations", {
  orderId: text("order_id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  ticketTierId: text("ticket_tier_id").notNull(),
  unitQuantity: integer("unit_quantity").notNull(),
  admissionCount: integer("admission_count").notNull(),
  status: text("status", { enum: ["held", "consumed", "released", "expired"] }).notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("inventory_reservations_capacity_idx").on(table.ticketTierId, table.status, table.expiresAt),
]);

export const paymentRefunds = sqliteTable("payment_refunds", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  paystackRefundId: text("paystack_refund_id"),
  amountMinor: integer("amount_minor").notNull(),
  status: text("status", { enum: ["pending", "processing", "processed", "failed"] }).notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: text("requested_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  failureReason: text("failure_reason"),
}, (table) => [
  index("payment_refunds_order_idx").on(table.orderId, table.status),
]);

export const paymentDisputes = sqliteTable("payment_disputes", {
  id: text("id").primaryKey(),
  orderId: text("order_id"),
  paystackDisputeId: text("paystack_dispute_id"),
  reference: text("reference").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  category: text("category"),
  amountMinor: integer("amount_minor"),
  dueAt: text("due_at"),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("payment_disputes_paystack_unique").on(table.paystackDisputeId),
  index("payment_disputes_reference_idx").on(table.reference, table.status),
]);

export const reconciliationRuns = sqliteTable("reconciliation_runs", {
  id: text("id").primaryKey(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  matchedCount: integer("matched_count").notNull().default(0),
  mismatchCount: integer("mismatch_count").notNull().default(0),
  missingCount: integer("missing_count").notNull().default(0),
  initiatedBy: text("initiated_by").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  error: text("error"),
}, (table) => [index("reconciliation_period_idx").on(table.periodStart, table.periodEnd)]);

export const reconciliationEntries = sqliteTable("reconciliation_entries", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  orderId: text("order_id"),
  reference: text("reference").notNull(),
  localStatus: text("local_status"),
  providerStatus: text("provider_status"),
  localAmountMinor: integer("local_amount_minor"),
  providerAmountMinor: integer("provider_amount_minor"),
  result: text("result", { enum: ["matched", "mismatch", "missing_local", "missing_provider"] }).notNull(),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("reconciliation_entries_run_idx").on(table.runId, table.result)]);

export const eventSettlements = sqliteTable("event_settlements", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  grossMinor: integer("gross_minor").notNull(),
  bookingFeesMinor: integer("booking_fees_minor").notNull(),
  refundsMinor: integer("refunds_minor").notNull(),
  netTicketSalesMinor: integer("net_ticket_sales_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  status: text("status", { enum: ["draft", "ready", "paid", "held"] }).notNull().default("draft"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("event_settlements_run_event_unique").on(table.runId, table.eventSlug),
  index("event_settlements_event_idx").on(table.eventSlug, table.periodEnd),
]);

export const attendeeRecoveryGrants = sqliteTable("attendee_recovery_grants", {
  id: text("id").primaryKey(),
  normalizedEmail: text("normalized_email").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
  requestedIpHash: text("requested_ip_hash"),
}, (table) => [
  uniqueIndex("attendee_recovery_token_unique").on(table.tokenHash),
  index("attendee_recovery_email_idx").on(table.normalizedEmail, table.expiresAt),
]);

export const deliveryEvents = sqliteTable("delivery_events", {
  id: text("id").primaryKey(),
  orderId: text("order_id"),
  recoveryGrantId: text("recovery_grant_id"),
  kind: text("kind", { enum: ["payment_confirmation", "ticket_recovery"] }).notNull(),
  recipient: text("recipient").notNull(),
  providerId: text("provider_id"),
  status: text("status", { enum: ["queued", "sent", "failed", "bounced"] }).notNull(),
  failureReason: text("failure_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("delivery_events_order_idx").on(table.orderId, table.kind, table.createdAt),
  index("delivery_events_recipient_idx").on(table.recipient, table.createdAt),
]);

export const curationAuditEvents = sqliteTable("curation_audit_events", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("curation_audit_submission_idx").on(table.submissionId, table.createdAt)]);

export const staffAccounts = sqliteTable("staff_accounts", {
  id: text("id").primaryKey(),
  normalizedEmail: text("normalized_email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "curator", "finance", "organizer", "gate", "moderator"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  passwordChangedAt: text("password_changed_at").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("staff_accounts_email_unique").on(table.normalizedEmail),
  index("staff_accounts_role_status_idx").on(table.role, table.status),
]);

export const staffSessions = sqliteTable("staff_sessions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
}, (table) => [
  uniqueIndex("staff_sessions_token_unique").on(table.tokenHash),
  index("staff_sessions_account_idx").on(table.accountId, table.expiresAt),
]);

export const staffEventAssignments = sqliteTable("staff_event_assignments", {
  accountId: text("account_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  assignedBy: text("assigned_by").notNull(),
  assignedAt: text("assigned_at").notNull(),
}, (table) => [
  uniqueIndex("staff_event_assignments_unique").on(table.accountId, table.eventSlug),
  index("staff_event_assignments_event_idx").on(table.eventSlug, table.accountId),
]);

export const organizerRequests = sqliteTable("organizer_requests", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  requestedBy: text("requested_by").notNull(),
  kind: text("kind", { enum: ["cancel_event", "reschedule_event", "refund_order", "inventory_change", "other"] }).notNull(),
  orderId: text("order_id"),
  detail: text("detail").notNull(),
  status: text("status", { enum: ["open", "approved", "rejected", "completed"] }).notNull().default("open"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("organizer_requests_event_status_idx").on(table.eventSlug, table.status, table.createdAt)]);

export const operationalAuditEvents = sqliteTable("operational_audit_events", {
  id: text("id").primaryKey(),
  actorAccountId: text("actor_account_id"),
  actorEmail: text("actor_email"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  outcome: text("outcome", { enum: ["success", "denied", "failed"] }).notNull(),
  detail: text("detail"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operational_audit_actor_idx").on(table.actorAccountId, table.createdAt),
  index("operational_audit_target_idx").on(table.targetType, table.targetId, table.createdAt),
]);

export const securityEvents = sqliteTable("security_events", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["login_failed", "login_locked", "turnstile_failed", "rate_limited", "access_denied", "runtime_error"] }).notNull(),
  subjectHash: text("subject_hash"),
  path: text("path").notNull(),
  requestId: text("request_id"),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("security_events_kind_idx").on(table.kind, table.createdAt)]);

export const systemAlerts = sqliteTable("system_alerts", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  severity: text("severity", { enum: ["warning", "critical"] }).notNull(),
  message: text("message").notNull(),
  detail: text("detail"),
  status: text("status", { enum: ["open", "acknowledged", "resolved"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => [index("system_alerts_status_idx").on(table.status, table.createdAt)]);
