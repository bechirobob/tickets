import { sql } from "drizzle-orm";
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
  promoterCode: text("promoter_code"),
  waitlistEntryId: text("waitlist_entry_id"),
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
  emailVerifiedAt: text("email_verified_at"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("attendee_profiles_verified_email_unique")
    .on(table.normalizedEmail)
    .where(sql`${table.emailVerifiedAt} IS NOT NULL`),
  index("attendee_profiles_email_idx").on(table.normalizedEmail, table.emailVerifiedAt),
]);

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

export const ticketGateCredentials = sqliteTable("ticket_gate_credentials", {
  ticketId: text("ticket_id").primaryKey(),
  token: text("token").notNull(),
  issuedAt: text("issued_at").notNull(),
  rotatedAt: text("rotated_at"),
}, (table) => [uniqueIndex("ticket_gate_credentials_token_unique").on(table.token)]);

export const ticketAssignments = sqliteTable("ticket_assignments", {
  ticketId: text("ticket_id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  assignedBy: text("assigned_by").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  assignedAt: text("assigned_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [index("ticket_assignments_attendee_idx").on(table.attendeeId, table.status)]);

export const hosts = sqliteTable("hosts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  bio: text("bio").notNull(),
  city: text("city").notNull().default("Accra"),
  verificationStatus: text("verification_status", { enum: ["verified", "reviewed", "unverified"] }).notNull().default("reviewed"),
  profileImageUrl: text("profile_image_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("hosts_slug_unique").on(table.slug)]);

export const eventHosts = sqliteTable("event_hosts", {
  eventSlug: text("event_slug").notNull(),
  hostId: text("host_id").notNull(),
  role: text("role").notNull().default("Host"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("event_hosts_unique").on(table.eventSlug, table.hostId),
  index("event_hosts_host_idx").on(table.hostId, table.eventSlug),
]);

export const attendeeHostFollows = sqliteTable("attendee_host_follows", {
  attendeeId: text("attendee_id").notNull(),
  hostId: text("host_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("attendee_host_follows_unique").on(table.attendeeId, table.hostId),
  index("attendee_host_follows_host_idx").on(table.hostId, table.createdAt),
]);

export const attendeeEventPreferences = sqliteTable("attendee_event_preferences", {
  attendeeId: text("attendee_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  attendeeVisible: integer("attendee_visible", { mode: "boolean" }).notNull().default(false),
  keepPosted: integer("keep_posted", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("attendee_event_preferences_unique").on(table.attendeeId, table.eventSlug),
  index("attendee_event_preferences_event_idx").on(table.eventSlug, table.keepPosted),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastSuccessAt: text("last_success_at"),
  failureCount: integer("failure_count").notNull().default(0),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  index("push_subscriptions_attendee_idx").on(table.attendeeId, table.revokedAt),
]);

export const notificationPreferences = sqliteTable("notification_preferences", {
  attendeeId: text("attendee_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  roomMessages: integer("room_messages", { mode: "boolean" }).notNull().default(true),
  hostUpdates: integer("host_updates", { mode: "boolean" }).notNull().default(true),
  mutedUntil: text("muted_until"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("notification_preferences_attendee_event_unique").on(table.attendeeId, table.eventSlug),
  index("notification_preferences_event_idx").on(table.eventSlug, table.roomMessages, table.mutedUntil),
]);

export const attendeeNotifications = sqliteTable("attendee_notifications", {
  id: text("id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  eventSlug: text("event_slug"),
  kind: text("kind", { enum: ["room_message", "host_update", "ticket_transfer", "gate_update", "event_reminder", "test", "waitlist_offer", "payment_recovery", "event_status", "support_update"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
}, (table) => [
  index("attendee_notifications_inbox_idx").on(table.attendeeId, table.readAt, table.createdAt),
  uniqueIndex("attendee_notifications_source_unique").on(table.attendeeId, table.kind, table.sourceId),
]);

export const ticketTransfers = sqliteTable("ticket_transfers", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  senderAttendeeId: text("sender_attendee_id").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status", { enum: ["pending", "accepted", "cancelled", "expired"] }).notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  acceptedAt: text("accepted_at"),
  cancelledAt: text("cancelled_at"),
  recipientAttendeeId: text("recipient_attendee_id"),
}, (table) => [
  uniqueIndex("ticket_transfers_token_unique").on(table.tokenHash),
  index("ticket_transfers_ticket_status_idx").on(table.ticketId, table.status, table.expiresAt),
  index("ticket_transfers_sender_idx").on(table.senderAttendeeId, table.status, table.createdAt),
]);

export const gateCheckinEvents = sqliteTable("gate_checkin_events", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  action: text("action", { enum: ["check_in", "undo"] }).notNull(),
  gate: text("gate").notNull(),
  actorAccountId: text("actor_account_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  deviceId: text("device_id"),
  clientScanId: text("client_scan_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("gate_checkin_events_client_scan_unique").on(table.clientScanId),
  index("gate_checkin_events_ticket_idx").on(table.ticketId, table.createdAt),
  index("gate_checkin_events_event_idx").on(table.eventSlug, table.createdAt),
]);

export const attendeePrivacySettings = sqliteTable("attendee_privacy_settings", {
  attendeeId: text("attendee_id").primaryKey(),
  defaultAttendeeVisible: integer("default_attendee_visible", { mode: "boolean" }).notNull().default(false),
  allowHostUpdates: integer("allow_host_updates", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export const eventQuestions = sqliteTable("event_questions", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  prompt: text("prompt").notNull(),
  kind: text("kind", { enum: ["text", "choice"] }).notNull().default("text"),
  optionsJson: text("options_json"),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("event_questions_event_idx").on(table.eventSlug, table.status, table.sortOrder)]);

export const attendeeQuestionAnswers = sqliteTable("attendee_question_answers", {
  questionId: text("question_id").notNull(),
  attendeeId: text("attendee_id").notNull(),
  answer: text("answer").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("attendee_question_answers_unique").on(table.questionId, table.attendeeId),
  index("attendee_question_answers_attendee_idx").on(table.attendeeId, table.updatedAt),
]);

export const eventUpdates = sqliteTable("event_updates", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  publishedAt: text("published_at").notNull(),
  publishedBy: text("published_by").notNull(),
}, (table) => [index("event_updates_event_idx").on(table.eventSlug, table.publishedAt)]);

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
  action: text("action", { enum: ["announcement", "pin", "unpin", "remove_message", "remove_flash", "suspend_attendee", "restore_attendee"] }).notNull(),
  messageId: text("message_id"),
  targetAttendeeId: text("target_attendee_id"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("room_moderation_event_idx").on(table.eventSlug, table.createdAt)]);

export const roomSettings = sqliteTable("room_settings", {
  eventSlug: text("event_slug").primaryKey(),
  emergencyReadOnly: integer("emergency_read_only", { mode: "boolean" }).notNull().default(false),
  slowModeSeconds: integer("slow_mode_seconds").notNull().default(0),
  archivedAt: text("archived_at"),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const eventMemories = sqliteTable("event_memories", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  publishedAt: text("published_at").notNull(),
  publishedBy: text("published_by").notNull(),
}, (table) => [index("event_memories_event_idx").on(table.eventSlug, table.publishedAt)]);

export const roomSuspensions = sqliteTable("room_suspensions", {
  eventSlug: text("event_slug").notNull(),
  attendeeId: text("attendee_id").notNull(),
  reason: text("reason").notNull(),
  suspendedAt: text("suspended_at").notNull(),
  suspendedBy: text("suspended_by").notNull(),
  restoredAt: text("restored_at"),
  restoredBy: text("restored_by"),
}, (table) => [
  uniqueIndex("room_suspensions_event_attendee_unique").on(table.eventSlug, table.attendeeId),
  index("room_suspensions_active_idx").on(table.eventSlug, table.restoredAt),
]);

export const roomFlashes = sqliteTable("room_flashes", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  attendeeId: text("attendee_id").notNull(),
  imageData: blob("image_data", { mode: "buffer" }),
  contentType: text("content_type").notNull().default("image/webp"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status", { enum: ["active", "hidden", "deleted"] }).notNull().default("active"),
  moderationResult: text("moderation_result", { enum: ["allowed", "reported", "moderator_removed", "owner_removed", "expired"] }).notNull().default("allowed"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("room_flashes_event_status_idx").on(table.eventSlug, table.status, table.createdAt),
  index("room_flashes_expiry_idx").on(table.status, table.expiresAt),
  index("room_flashes_attendee_idx").on(table.attendeeId, table.eventSlug, table.status),
]);

export const roomFlashReports = sqliteTable("room_flash_reports", {
  id: text("id").primaryKey(),
  flashId: text("flash_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  reporterAttendeeId: text("reporter_attendee_id").notNull(),
  reason: text("reason", { enum: ["nonconsensual", "explicit", "unsafe", "spam", "other"] }).notNull(),
  details: text("details"),
  status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => [
  uniqueIndex("room_flash_reports_reporter_unique").on(table.flashId, table.reporterAttendeeId),
  index("room_flash_reports_event_status_idx").on(table.eventSlug, table.status, table.createdAt),
]);

export const roomFlashModerationEvents = sqliteTable("room_flash_moderation_events", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  attendeeId: text("attendee_id").notNull(),
  outcome: text("outcome", { enum: ["allowed", "blocked", "unavailable"] }).notNull(),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("room_flash_moderation_event_idx").on(table.eventSlug, table.createdAt)]);

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
  index("party_submissions_contact_email_idx").on(table.contactEmail, table.createdAt),
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
  isTestEvent: integer("is_test_event", { mode: "boolean" }).notNull().default(false),
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

export const eventWaitlistEntries = sqliteTable("event_waitlist_entries", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  ticketTierId: text("ticket_tier_id"),
  normalizedEmail: text("normalized_email").notNull(),
  phone: text("phone"),
  status: text("status", { enum: ["waiting", "offered", "claimed", "expired", "cancelled"] }).notNull().default("waiting"),
  offerTokenHash: text("offer_token_hash"),
  offeredAt: text("offered_at"),
  offerExpiresAt: text("offer_expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("event_waitlist_active_email_unique").on(table.eventSlug, table.normalizedEmail),
  uniqueIndex("event_waitlist_offer_token_unique").on(table.offerTokenHash),
  index("event_waitlist_queue_idx").on(table.eventSlug, table.ticketTierId, table.status, table.createdAt),
]);

export const eventPromoterCodes = sqliteTable("event_promoter_codes", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
}, (table) => [
  uniqueIndex("event_promoter_codes_event_code_unique").on(table.eventSlug, table.code),
  index("event_promoter_codes_event_status_idx").on(table.eventSlug, table.status),
]);

export const paymentRecoveryEvents = sqliteTable("payment_recovery_events", {
  orderId: text("order_id").primaryKey(),
  providerStatus: text("provider_status").notNull(),
  deliveryStatus: text("delivery_status", { enum: ["queued", "sent", "failed", "suppressed"] }).notNull(),
  attemptedAt: text("attempted_at").notNull(),
  detail: text("detail"),
});

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
  ticketIdsJson: text("ticket_ids_json"),
  batchId: text("batch_id"),
}, (table) => [
  index("payment_refunds_order_idx").on(table.orderId, table.status),
  index("payment_refunds_batch_idx").on(table.batchId, table.status),
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
  kind: text("kind", { enum: ["payment_confirmation", "ticket_recovery", "ticket_transfer", "waitlist_offer", "payment_recovery", "support_update", "operational_alert"] }).notNull(),
  recipient: text("recipient").notNull(),
  providerId: text("provider_id"),
  status: text("status", { enum: ["queued", "sent", "delivered", "delayed", "failed", "bounced", "complained", "suppressed"] }).notNull(),
  failureReason: text("failure_reason"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  providerEventAt: text("provider_event_at"),
  payloadJson: text("payload_json"),
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
  role: text("role", { enum: ["owner", "curator", "finance", "support", "organizer", "gate", "moderator"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLoginAt: text("last_login_at"),
  passwordChangedAt: text("password_changed_at").notNull(),
  mfaRequired: integer("mfa_required", { mode: "boolean" }).notNull().default(false),
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
  deviceLabel: text("device_label"),
  mfaVerifiedAt: text("mfa_verified_at"),
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

export const attendeeEventDecisions = sqliteTable("attendee_event_decisions", {
  attendeeId: text("attendee_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  decision: text("decision", { enum: ["accepted_reschedule", "refund_requested"] }).notNull(),
  decidedAt: text("decided_at").notNull(),
}, (table) => [
  uniqueIndex("attendee_event_decisions_unique").on(table.attendeeId, table.eventSlug),
  index("attendee_event_decisions_event_idx").on(table.eventSlug, table.decision),
]);

export const supportCases = sqliteTable("support_cases", {
  id: text("id").primaryKey(),
  attendeeId: text("attendee_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  orderId: text("order_id"),
  kind: text("kind", { enum: ["general", "refund", "reschedule", "ticket", "entry"] }).notNull().default("general"),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["open", "waiting_customer", "waiting_support", "resolved", "closed"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("support_cases_attendee_idx").on(table.attendeeId, table.updatedAt),
  index("support_cases_queue_idx").on(table.status, table.updatedAt),
  index("support_cases_event_idx").on(table.eventSlug, table.status),
]);

export const supportMessages = sqliteTable("support_messages", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  authorType: text("author_type", { enum: ["attendee", "staff", "system"] }).notNull(),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("support_messages_case_idx").on(table.caseId, table.createdAt)]);

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

export const staffPasskeys = sqliteTable("staff_passkeys", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  credentialId: text("credential_id").notNull(),
  publicKey: blob("public_key", { mode: "buffer" }).notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  transportsJson: text("transports_json"),
  label: text("label").notNull().default("Passkey"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
}, (table) => [
  uniqueIndex("staff_passkeys_credential_unique").on(table.credentialId),
  index("staff_passkeys_account_idx").on(table.accountId, table.createdAt),
]);

export const staffAuthChallenges = sqliteTable("staff_auth_challenges", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  purpose: text("purpose", { enum: ["registration", "authentication"] }).notNull(),
  challenge: text("challenge").notNull(),
  exchangeTokenHash: text("exchange_token_hash").notNull(),
  returnTo: text("return_to"),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("staff_auth_challenges_exchange_unique").on(table.exchangeTokenHash),
  index("staff_auth_challenges_account_idx").on(table.accountId, table.purpose, table.expiresAt),
]);

export const staffRecoveryCodes = sqliteTable("staff_recovery_codes", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  codeHash: text("code_hash").notNull(),
  createdAt: text("created_at").notNull(),
  usedAt: text("used_at"),
}, (table) => [index("staff_recovery_codes_account_idx").on(table.accountId, table.usedAt)]);

export const policyVersions = sqliteTable("policy_versions", {
  id: text("id").primaryKey(),
  policy: text("policy", { enum: ["purchase", "refund", "privacy", "community", "organizer"] }).notNull(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  contentHash: text("content_hash").notNull(),
  effectiveAt: text("effective_at").notNull(),
  retiredAt: text("retired_at"),
}, (table) => [uniqueIndex("policy_versions_policy_version_unique").on(table.policy, table.version)]);

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type", { enum: ["order", "organizer_submission", "attendee"] }).notNull(),
  subjectId: text("subject_id").notNull(),
  policy: text("policy").notNull(),
  version: text("version").notNull(),
  actorEmail: text("actor_email"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  acceptedAt: text("accepted_at").notNull(),
}, (table) => [
  uniqueIndex("consent_records_subject_policy_unique").on(table.subjectType, table.subjectId, table.policy, table.version),
  index("consent_records_subject_idx").on(table.subjectType, table.subjectId, table.acceptedAt),
]);

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["event_cancellation", "mass_refund", "organizer_payout"] }).notNull(),
  eventSlug: text("event_slug"),
  targetId: text("target_id"),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "executing", "completed", "failed"] }).notNull().default("pending"),
  requestedBy: text("requested_by").notNull(),
  requestedByEmail: text("requested_by_email").notNull(),
  requestedAt: text("requested_at").notNull(),
  decidedBy: text("decided_by"),
  decidedByEmail: text("decided_by_email"),
  decidedAt: text("decided_at"),
  decisionNote: text("decision_note"),
  completedAt: text("completed_at"),
  failureReason: text("failure_reason"),
}, (table) => [index("approval_requests_status_idx").on(table.status, table.requestedAt)]);

export const gateDevices = sqliteTable("gate_devices", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  gate: text("gate").notNull(),
  accountId: text("account_id").notNull(),
  accountEmail: text("account_email").notNull(),
  pendingOfflineScans: integer("pending_offline_scans").notNull().default(0),
  manifestGeneratedAt: text("manifest_generated_at"),
  lastSyncAt: text("last_sync_at"),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [index("gate_devices_event_idx").on(table.eventSlug, table.lastSeenAt)]);

export const operationalIncidents = sqliteTable("operational_incidents", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  status: text("status", { enum: ["open", "monitoring", "resolved"] }).notNull().default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
}, (table) => [index("operational_incidents_event_idx").on(table.eventSlug, table.status, table.createdAt)]);

export const eventReadinessChecks = sqliteTable("event_readiness_checks", {
  eventSlug: text("event_slug").notNull(),
  checkKey: text("check_key").notNull(),
  label: text("label").notNull(),
  status: text("status", { enum: ["pending", "passed", "blocked"] }).notNull().default("pending"),
  note: text("note"),
  checkedBy: text("checked_by"),
  checkedAt: text("checked_at"),
}, (table) => [uniqueIndex("event_readiness_checks_unique").on(table.eventSlug, table.checkKey)]);

export const productMetricsDaily = sqliteTable("product_metrics_daily", {
  day: text("day").notNull(),
  eventSlug: text("event_slug").notNull().default(""),
  metric: text("metric", { enum: [
    "event_view",
    "checkout_view",
    "checkout_started",
    "payment_attempted",
    "payment_confirmed",
    "payment_failed",
    "recovery_requested",
    "share_started",
    "pwa_prompt_shown",
    "pwa_install_accepted",
    "pwa_ios_guide_opened",
    "pwa_installed",
  ] }).notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("product_metrics_daily_unique").on(table.day, table.eventSlug, table.metric),
  index("product_metrics_daily_event_idx").on(table.eventSlug, table.day),
]);

export const guestEntries = sqliteTable("guest_entries", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  admissionCount: integer("admission_count").notNull().default(1),
  kind: text("kind", { enum: ["complimentary", "guest_list", "will_call"] }).notNull(),
  note: text("note"),
  status: text("status", { enum: ["expected", "checked_in", "cancelled"] }).notNull().default("expected"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  checkedInAt: text("checked_in_at"),
  checkedInBy: text("checked_in_by"),
}, (table) => [index("guest_entries_event_idx").on(table.eventSlug, table.status, table.guestName)]);

export const organizerPayoutAccounts = sqliteTable("organizer_payout_accounts", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  accountName: text("account_name").notNull(),
  recipientType: text("recipient_type", { enum: ["ghipss", "mobile_money"] }).notNull(),
  bankCode: text("bank_code").notNull(),
  accountNumberMasked: text("account_number_masked").notNull(),
  recipientCode: text("recipient_code").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  verifiedAt: text("verified_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("organizer_payout_accounts_event_idx").on(table.eventSlug, table.status)]);

export const payoutTransfers = sqliteTable("payout_transfers", {
  id: text("id").primaryKey(),
  settlementId: text("settlement_id").notNull(),
  eventSlug: text("event_slug").notNull(),
  payoutAccountId: text("payout_account_id").notNull(),
  approvalRequestId: text("approval_request_id"),
  reference: text("reference").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("GHS"),
  status: text("status", { enum: ["pending_approval", "queued", "otp", "pending", "success", "failed", "reversed"] }).notNull(),
  providerTransferCode: text("provider_transfer_code"),
  failureReason: text("failure_reason"),
  initiatedBy: text("initiated_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  paidAt: text("paid_at"),
}, (table) => [
  uniqueIndex("payout_transfers_reference_unique").on(table.reference),
  uniqueIndex("payout_transfers_settlement_unique").on(table.settlementId),
  index("payout_transfers_event_idx").on(table.eventSlug, table.status),
]);

export const refundBatches = sqliteTable("refund_batches", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  approvalRequestId: text("approval_request_id"),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["pending_approval", "queued", "processing", "completed", "completed_with_errors", "failed"] }).notNull(),
  totalOrders: integer("total_orders").notNull().default(0),
  processedOrders: integer("processed_orders").notNull().default(0),
  failedOrders: integer("failed_orders").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("refund_batches_status_idx").on(table.status, table.updatedAt)]);
