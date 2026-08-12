import { hashToken } from "./admin-session";

export type PolicyKey = "purchase" | "refund" | "privacy" | "community" | "organizer";

export const policies: Record<PolicyKey, { version: string; title: string; summary: string; points: readonly string[] }> = {
  purchase: {
    version: "2026-08-12",
    title: "Ticket purchase terms",
    summary: "The ticket belongs to the verified buyer or accepted recipient, and entry still follows the venue rules.",
    points: [
      "A ticket is issued only after the payment provider confirms the correct amount, currency and reference.",
      "QR codes may rotate after a transfer, refund, dispute or security action. Only the latest valid code admits a guest.",
      "The purchaser is responsible for accurate delivery details and must not share private recovery links.",
      "Event staff may refuse entry for a void, refunded, duplicated, transferred or already-used ticket.",
    ],
  },
  refund: {
    version: "2026-08-12",
    title: "Refund, cancellation and rescheduling",
    summary: "Refund eligibility follows the event state, organiser terms and Ghanaian consumer law—not whoever types in all caps first.",
    points: [
      "A cancelled event opens a refund review for the affected paid tickets.",
      "A rescheduled event lets the verified holder accept the new date or request a refund review within the stated window.",
      "Booking and processor fees are shown before payment; any non-refundable portion must be stated before checkout.",
      "Approved refunds return through the original payment rail. Processing time depends on the provider and issuing institution.",
    ],
  },
  privacy: {
    version: "2026-08-12",
    title: "Privacy and retention",
    summary: "We keep what makes tickets work, restrict who sees it, and delete or anonymise it when the job is finished.",
    points: [
      "Payment details stay with Paystack; BeCore stores transaction references, amounts, contact details and operational evidence.",
      "Ticket, entry, consent and financial audit records are retained for legal, fraud and reconciliation needs.",
      "Room content and temporary Flashes follow the event retention controls shown inside the Room.",
      "Authorised staff receive only the event and role access needed for their work.",
    ],
  },
  community: {
    version: "2026-08-12",
    title: "The Room rules",
    summary: "Bring the energy. Leave harassment, impersonation, spam and unsafe content outside.",
    points: [
      "Host notices must be truthful, useful and clearly marked.",
      "Attendees can report, mute and block. Moderators may slow, lock, remove or archive content when safety requires it.",
      "Do not share another person’s private information or non-consensual media.",
      "Serious or repeated abuse can suspend Room access without cancelling the underlying ticket unless entry safety is affected.",
    ],
  },
  organizer: {
    version: "2026-08-12",
    title: "Organiser agreement",
    summary: "The organiser owns the promises. BeCore owns the ticketing controls. Both sides keep receipts.",
    points: [
      "The organiser must provide accurate venue, capacity, timing, line-up, age, access and refund information.",
      "Payouts are released only after identity, destination, reconciliation, refund, reserve and dispute checks.",
      "BeCore may pause sales, entry or payout when safety, fraud, overselling, legal or reconciliation evidence requires it.",
      "Event cancellation, mass refunds and payouts require recorded approval and an audit trail.",
    ],
  },
};

export const purchasePolicyKeys: readonly PolicyKey[] = ["purchase", "refund", "privacy"];
export const organizerPolicyKeys: readonly PolicyKey[] = ["organizer", "privacy"];

export async function recordPolicyConsents(input: {
  db: D1Database;
  subjectType: "order" | "organizer_submission" | "attendee";
  subjectId: string;
  policyKeys: readonly PolicyKey[];
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  acceptedAt?: string;
}) {
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  const ipHash = input.ip ? await hashToken(input.ip) : null;
  const userAgentHash = input.userAgent ? await hashToken(input.userAgent) : null;
  const statements: D1PreparedStatement[] = [];
  for (const key of input.policyKeys) {
    const policy = policies[key];
    const contentHash = await hashToken(JSON.stringify(policy));
    statements.push(
      input.db.prepare(`
        INSERT OR IGNORE INTO policy_versions (id, policy, version, title, content_hash, effective_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(`${key}:${policy.version}`, key, policy.version, policy.title, contentHash, `${policy.version}T00:00:00.000Z`),
      input.db.prepare(`
        INSERT OR IGNORE INTO consent_records (
          id, subject_type, subject_id, policy, version, actor_email, ip_hash, user_agent_hash, accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), input.subjectType, input.subjectId, key, policy.version, input.actorEmail ?? null, ipHash, userAgentHash, acceptedAt),
    );
  }
  if (statements.length) await input.db.batch(statements);
}

