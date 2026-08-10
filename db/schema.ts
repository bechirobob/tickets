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
  paymentChannel: text("payment_channel").notNull(),
  status: text("status", { enum: ["payment_pending", "paid", "failed", "refunded", "expired"] }).notNull(),
  paystackReference: text("paystack_reference"),
  createdAt: text("created_at").notNull(),
  paidAt: text("paid_at"),
}, (table) => [
  uniqueIndex("orders_reference_unique").on(table.reference),
  index("orders_event_status_idx").on(table.eventSlug, table.status),
]);

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
