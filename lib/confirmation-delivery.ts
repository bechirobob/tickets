import { confirmationNotice, type NotificationPayload } from './notifications';

// The lease serializes concurrent callbacks. A crash may repeat a push after
// lease expiry (the stable tag replaces it); email has its own durable outbox.
export async function deliverConfirmation(input: {
  env: Cloudflare.Env; id: string; orderId?: string; attendeeId: string | null;
  payload: NotificationPayload; skipPush?: boolean; email: () => Promise<unknown>;
}): Promise<'push' | 'email' | 'pending'> {
  const { env, id, attendeeId, payload } = input;
  // Inbox updates remain available even when delivery already completed or the
  // order was only claimed after its first confirmation was sent.
  if (attendeeId) await confirmationNotice(env, attendeeId, payload, false);
  const now = new Date().toISOString(), token = crypto.randomUUID();
  const [, claim] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO confirmation_deliveries (id, order_id, created_at) VALUES (?, ?, ?)`)
      .bind(id, input.orderId ?? null, now),
    env.DB.prepare(`UPDATE confirmation_deliveries SET status='processing', lease_token=?, lease_until=?
      WHERE id=? AND (status='pending' OR (status='processing' AND lease_until<=?))`)
      .bind(token, new Date(Date.now() + 120_000).toISOString(), id, now),
  ]);
  if (!claim.meta.changes) {
    const row = await env.DB.prepare('SELECT status FROM confirmation_deliveries WHERE id=?').bind(id).first<{status:string}>();
    return row?.status === 'push' || row?.status === 'email' ? row.status : 'pending';
  }
  try {
    let accepted = 0;
    if (attendeeId && !input.skipPush) {
      try { accepted = await confirmationNotice(env, attendeeId, payload); }
      catch { console.error(JSON.stringify({ message: 'Confirmation push unavailable', sourceId: id })); }
    }
    const channel = accepted > 0 ? 'push' : 'email';
    if (channel === 'email') await input.email();
    await env.DB.prepare(`UPDATE confirmation_deliveries SET status=?, completed_at=?, lease_token=NULL, lease_until=NULL WHERE id=? AND lease_token=?`)
      .bind(channel, new Date().toISOString(), id, token).run();
    return channel;
  } catch (error) {
    await env.DB.prepare(`UPDATE confirmation_deliveries SET status='pending', lease_token=NULL, lease_until=NULL WHERE id=? AND lease_token=?`).bind(id, token).run();
    throw error;
  }
}
