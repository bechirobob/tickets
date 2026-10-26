import { transactionalConfigured, transactionalProvider } from '../../../lib/transactional-email';
import { limitRequestBody } from '../../../lib/request-body';
import { hashToken, mutationHasValidOrigin, requestMetadata } from '../../../lib/admin-session';
import { enforceCompositeRateLimit } from '../../../lib/security-controls';
import { captureYorkewaySignup, parseYorkewaySignup, YORKEWAY_CLOSES_AT } from '../../../lib/yorkeway-early-access';

export async function POST(request: Request) {
  const headers = { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer' };
  const bounded = await limitRequestBody(request, 2048);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'Please submit from this page.' }, { status: 403, headers });
  if (Date.now() >= Date.parse(YORKEWAY_CLOSES_AT)) return Response.json({ error: 'This year-end signup has closed.' }, { status: 410, headers });
  const input = parseYorkewaySignup(await request.json().catch(() => null));
  if (!input) return Response.json({ error: 'Enter your name and email, then choose whether to receive these updates.' }, { status: 400, headers });
  const { env } = await import('cloudflare:workers');
  if (!transactionalConfigured(env, transactionalProvider(env, 'yorkeway_confirmation'))) return Response.json({ error: 'Signup is temporarily unavailable. Please try again later.' }, { status: 503, headers });
  const ip = requestMetadata(request).ip || 'anonymous';
  if (!await enforceCompositeRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, [`yorkeway-ip:${await hashToken(ip)}`, `yorkeway-email:${await hashToken(input.email)}`])) {
    return Response.json({ error: 'Please wait a little before trying again.' }, { status: 429, headers });
  }
  try {
    await captureYorkewaySignup(env.DB, input);
    return Response.json({ received: true }, { status: 202, headers });
  } catch {
    return Response.json({ error: 'We could not save your request. Please try again.' }, { status: 503, headers });
  }
}
