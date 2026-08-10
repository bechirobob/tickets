import {
  adminCookieHeader,
  createAdminSession,
  expiredAdminCookieHeader,
  safeReturnTo,
} from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { accessKey?: string; returnTo?: string };
  const session = await createAdminSession(String(body.accessKey ?? ""));
  if (!session) {
    return Response.json(
      { error: "That access key did not open the door." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(
    { returnTo: safeReturnTo(body.returnTo) },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": adminCookieHeader(session),
      },
    },
  );
}

export async function DELETE() {
  return Response.json(
    { signedOut: true },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": expiredAdminCookieHeader(),
      },
    },
  );
}
