type Attempt = { requestHash: string; responseJson: string | null; responseStatus: number | null; createdAt: string; orderStatus: string | null; reservationExpiresAt: string | null };

export async function replayPaymentAttempt(db: D1Database, keyHash: string, requestHash: string): Promise<Response | null> {
  const existing = await db.prepare("SELECT attempt.request_hash AS requestHash, attempt.response_json AS responseJson, attempt.response_status AS responseStatus, attempt.created_at AS createdAt, orders.status AS orderStatus, orders.reservation_expires_at AS reservationExpiresAt FROM payment_attempts attempt LEFT JOIN orders ON orders.id = attempt.order_id WHERE attempt.key_hash = ?")
    .bind(keyHash).first<Attempt>();
  if (!existing) return null;
  const headers = { "cache-control": "no-store" };
  if (existing.requestHash !== requestHash) return Response.json({ error: "This payment attempt belongs to different checkout details." }, { status: 409, headers });
  if (Date.parse(existing.createdAt) < Date.now() - 24 * 60 * 60 * 1000) return Response.json({ error: "This payment attempt has expired. Check My Nights or contact support before paying again." }, { status: 410, headers });
  if (existing.orderStatus === "expired" || existing.orderStatus === "payment_pending" && existing.reservationExpiresAt && Date.parse(existing.reservationExpiresAt) <= Date.now()) return Response.json({ error: "The reservation has expired. Check your payment status in My Nights or contact support before paying again." }, { status: 410, headers });
  if (!existing.responseJson) return Response.json({ error: "Your original payment request is still being checked. Wait a moment and retry the same request." }, { status: 409, headers: { ...headers, "retry-after": "5" } });
  return new Response(existing.responseJson, { status: existing.responseStatus ?? 200, headers: { ...headers, "content-type": "application/json", "idempotency-replayed": "true" } });
}
