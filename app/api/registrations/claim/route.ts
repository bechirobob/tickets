import { mutationHasValidOrigin } from '../../../../lib/admin-session';
import { claimRegistration } from '../../../../lib/registrations';
export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This link could not be accepted.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { token?: string } | null;
  if (typeof body?.token !== 'string' || body.token.length < 40 || body.token.length > 128) return Response.json({ error: 'Open the complete link from your email.' }, { status: 400 });
  const { env } = await import('cloudflare:workers');
  try {
    const result = await claimRegistration(env.DB, body.token);
    return Response.json({ registration: result.registration }, { headers: { 'set-cookie': result.cookie, 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'This link could not be accepted.' }, { status: 400 }); }
}
