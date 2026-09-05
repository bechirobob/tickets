export class RequestError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "RequestError";
  }
}

/** Bound waiting, preserve API errors, and never treat an unreadable response as success. */
export async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const serverMessage = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : null;
      throw new RequestError(serverMessage ?? (response.status === 401 ? "Your session has expired. Recover your tickets to sign in again." : "The request could not be completed. Please try again."), response.status);
    }
    if (!data || typeof data !== "object") throw new RequestError("The response could not be read. Refresh to check the latest status before trying again.");
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(controller.signal.aborted
      ? "This is taking too long. Refresh to check the latest status before trying again."
      : "Connection lost. Your last action may have completed. Refresh to check before trying again.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
