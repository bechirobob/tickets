import { enforceRateLimit } from '../../../../lib/security-controls';
import { limitRequestBody } from '../../../../lib/request-body';
import { hashToken, requestMetadata, mutationHasValidOrigin } from '../../../../lib/admin-session';
import { withdrawYorkewaySignup } from '../../../../lib/yorkeway-early-access';

export async function POST(request: Request) {
  const headers = { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer' };
  const bounded = await limitRequestBody(request, 1024);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'Please submit from this page.' }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string') return Response.json({ error: 'A withdrawal link is required.' }, { status: 400, headers });
  const { env } = await import('cloudflare:workers');
  if (!await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `yorkeway-withdraw:${await hashToken(requestMetadata(request).ip || 'anonymous')}`)) return Response.json({ error: 'Please wait a little before trying again.' }, { status: 429, headers });
  await withdrawYorkewaySignup(env.DB, body.token);
  return Response.json({ received: true }, { headers });
}
