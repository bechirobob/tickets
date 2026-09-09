import { mutationHasValidOrigin, requestMetadata } from '../../../lib/admin-session';
import { hashToken } from '../../../lib/attendee-auth';
import { enforceRateLimit } from '../../../lib/security-controls';
import { requestRegistration } from '../../../lib/registrations';
export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This registration was not accepted.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { acceptedTerms?: boolean; eventSlug?: string; email?: string; guestName?: string; phone?: string; partySize?: number } | null;
  if (!body || typeof body !== 'object' || body.acceptedTerms !== true) return Response.json({ error: 'Accept the event terms and privacy notice.' }, { status: 400 });
  for (const key of ['eventSlug', 'email', 'guestName', 'phone'] as const) if (typeof body[key] !== 'string' || body[key]!.length > 254) return Response.json({ error: 'Check your registration details.' }, { status: 400 });
  const input = { eventSlug: (body.eventSlug ?? '').trim(), email: (body.email ?? '').trim().toLowerCase(), guestName: (body.guestName ?? '').trim(), phone: (body.phone ?? '').trim(), partySize: body.partySize ?? 0 };
  if (!/^[a-z0-9-]{1,80}$/u.test(input.eventSlug) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.email) || input.guestName.length < 2 || input.guestName.length > 120 || input.phone.length > 40) return Response.json({ error: 'Add your name and a valid email address.' }, { status: 400 });
  const { env } = await import('cloudflare:workers');
  const ip = requestMetadata(request).ip ?? 'unknown';
  const allowed = await Promise.all([enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `registration-ip:${await hashToken(ip)}`), enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `registration-email:${await hashToken(input.email)}`)]);
  if (allowed.some(value => !value)) return Response.json({ error: 'Give it a minute before trying again.' }, { status: 429 });
  try { await requestRegistration(env.DB, input, new URL(request.url).origin); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Registration could not be saved.' }, { status: 400 }); }
  return Response.json({ message: 'Check your email to confirm or manage your registration. Your place is only reserved once confirmed.' }, { status: 202, headers: { 'cache-control': 'no-store' } });
}
