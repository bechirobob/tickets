/** Recovery follows the current holder, never the original payer after transfer. */
export const recoverableTickets = `
  FROM tickets t JOIN orders o ON o.id = t.order_id
  LEFT JOIN ticket_assignments a ON a.ticket_id = t.id
  LEFT JOIN attendee_profiles holder ON holder.id = a.attendee_id
  WHERE o.status = 'paid' AND t.status IN ('issued','checked_in','voided')
    AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = t.event_slug AND e.removed_at IS NOT NULL)
    AND ((a.status = 'active' AND holder.normalized_email = ? AND holder.status = 'active')
      OR (a.ticket_id IS NULL AND LOWER(o.customer_email) = ?))
`;

export function customerAccessHeaders() {
  return { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };
}

export function accessLanding(request: Request, kind: 'recovery' | 'transfer') {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const next = new URL('/my-nights/access', url.origin);
  next.searchParams.set('kind', kind);
  if (/^[A-Za-z0-9_-]{40,128}$/u.test(token)) next.hash = new URLSearchParams({ token }).toString();
  return new Response(null, { status: 303, headers: { ...customerAccessHeaders(), location: next.href } });
}

export async function readAccessToken(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === 'object' && 'token' in body && typeof body.token === 'string'
    && /^[A-Za-z0-9_-]{40,128}$/u.test(body.token) ? body.token : null;
}
