import { readAdminSession, defaultWorkspace } from "../../../../lib/admin-session";
export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  const headers = { "cache-control": "no-store, private", "vary": "Cookie" };
  if (!session) return Response.json({ authenticated: false }, { status: 401, headers });
  return Response.json({ role: session.role, returnTo: session.mustChangePassword ? "/admin/account" : defaultWorkspace(session.role) }, { headers });
}
