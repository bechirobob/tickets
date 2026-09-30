import { readBackgroundHealth } from "./background-health";

export type OperationException = { key: string; label: string; count: number; oldestAt: string; state: "retry_scheduled" | "needs_review"; href: string };

/** Owner-only projection: counts and safe recovery destinations, never payloads or access links. */
export async function readOperationExceptions(db: D1Database) {
  const [deliveries, pending, externalRefunds, jobs] = await Promise.all([
    db.prepare(`SELECT d.kind, CASE WHEN d.status='failed' AND d.next_attempt_at IS NULL THEN 'needs_review' ELSE 'retry_scheduled' END AS state,
      COUNT(*) AS count, MIN(d.created_at) AS oldestAt
      FROM delivery_events d
      WHERE d.status IN ('queued','failed','delayed') AND d.kind IN ('payment_confirmation','ticket_recovery','registration_access','registration_update','organizer_invitation','team_invitation','host_application_verify','host_application_decision')
      AND (d.kind NOT IN ('payment_confirmation','ticket_recovery') OR EXISTS (SELECT 1 FROM orders o WHERE o.id=d.order_id AND o.status='paid') OR EXISTS (SELECT 1 FROM attendee_recovery_grants g WHERE g.id=d.recovery_grant_id AND g.used_at IS NULL AND julianday(g.expires_at)>julianday('now')))
      AND (d.kind<>'team_invitation' OR EXISTS (SELECT 1 FROM organizer_team_invites i WHERE i.id=d.recovery_grant_id AND i.used_at IS NULL AND i.revoked_at IS NULL AND julianday(i.expires_at)>julianday('now')))
      AND (d.kind<>'organizer_invitation' OR EXISTS (SELECT 1 FROM organizer_invitations i WHERE i.id=d.recovery_grant_id AND i.used_at IS NULL AND julianday(i.expires_at)>julianday('now')))
      AND NOT EXISTS (SELECT 1 FROM delivery_events newer WHERE newer.kind=d.kind AND newer.recipient=d.recipient AND COALESCE(newer.order_id,newer.recovery_grant_id,'')=COALESCE(d.order_id,d.recovery_grant_id,'') AND newer.created_at>d.created_at)
      GROUP BY d.kind,state ORDER BY oldestAt LIMIT 30`).all<{ kind: string; state: OperationException["state"]; count: number; oldestAt: string }>(),
    db.prepare(`SELECT payment_provider AS provider,COUNT(*) AS count,MIN(created_at) AS oldestAt FROM orders
      WHERE payment_provider IN ('paystack','seevplus') AND status='payment_pending' AND julianday(created_at)<julianday('now','-10 minutes')
      GROUP BY payment_provider`).all<{ provider: string; count: number; oldestAt: string }>(),
    db.prepare(`SELECT r.provider,COUNT(*) AS count,MIN(r.recorded_at) AS oldestAt FROM provider_operation_records r
      WHERE r.kind='refund' AND r.status='pending' AND NOT EXISTS (SELECT 1 FROM provider_operation_records n WHERE n.order_id=r.order_id AND n.kind=r.kind AND n.version>r.version)
      GROUP BY r.provider`).all<{ provider: string; count: number; oldestAt: string }>(),
    readBackgroundHealth(db),
  ]);
  const exceptions: OperationException[] = deliveries.results.map(item => ({ key: `delivery:${item.kind}:${item.state}`, label: item.kind.replaceAll("_", " "), count: item.count, oldestAt: item.oldestAt, state: item.state,
    href: item.kind === "team_invitation" ? "/organizer/workspace?area=team" : item.kind.includes("invitation") || item.kind.startsWith("host_application") ? "/admin/hosts" : item.kind.startsWith("registration") ? "/admin/registrations" : "/admin/orders" }));
  for (const item of pending.results) exceptions.push({ key: `payment:${item.provider}`, label: `${item.provider === "seevplus" ? "SeevPlus" : "Paystack"} payment verification`, count: item.count, oldestAt: item.oldestAt, state: "needs_review", href: `/admin/orders?status=payment_pending&provider=${item.provider}` });
  for (const item of externalRefunds.results) exceptions.push({ key: `external-refund:${item.provider}`, label: `${item.provider === "seevplus" ? "SeevPlus" : "Paystack"} external refund cases pending`, count: item.count, oldestAt: item.oldestAt, state: "needs_review", href: `/admin/orders?provider=${item.provider}` });
  return { exceptions, jobs };
}
