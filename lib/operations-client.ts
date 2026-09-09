import { RequestError, requestJson } from "./client-request";

/** Keep the existing response-based screens recoverable on transport/JSON failure. */
export async function operationsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return Response.json(await requestJson<unknown>(url, init));
  } catch (error) {
    const status = error instanceof RequestError ? error.status : null;
    const message = status === 401 || status === 403
      ? "Your session has expired or lacks access. Sign in to Operations again."
      : error instanceof Error ? error.message : "The request failed. Refresh to check its status.";
    return Response.json({ error: message }, { status: status ?? 503 });
  }
}
