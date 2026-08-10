import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  quantity: integer("quantity").notNull(),
  faceAmountMinor: integer("face_amount_minor").notNull(),
  bookingFeeMinor: integer("booking_fee_minor").notNull(),
  totalAmountMinor: integer("total_amount_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  paymentChannel: text("payment_channel").notNull(),
  status: text("status", { enum: ["payment_pending", "paid", "failed", "refunded", "expired"] }).notNull(),
  paystackReference: text("paystack_reference"),
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
  qrTokenHash: text("qr_token_hash").notNull(),
  status: text("status", { enum: ["issued", "transferred", "checked_in", "voided", "refunded"] }).notNull(),
  issuedAt: text("issued_at").notNull(),
  checkedInAt: text("checked_in_at"),
}, (table) => [
  uniqueIndex("tickets_qr_token_unique").on(table.qrTokenHash),
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
