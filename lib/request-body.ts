/** Bound the actual stream, including chunked uploads and dishonest length headers. */
export class RequestBodyTooLarge extends Error {
  constructor() { super('Request body is too large.'); }
}

export async function boundedRequestBytes(request: Request, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new RequestBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new RequestBodyTooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function boundedFormData(request: Request, maximumBytes: number): Promise<FormData> {
  return new Response(await boundedRequestBytes(request, maximumBytes), {
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  }).formData();
}

/** Preserve exact webhook bytes and ordinary parser behavior after bounding I/O.
 * Called before route parsing so local .catch() handlers cannot swallow 413s.
 * The default accommodates existing batch/API payloads; small token and raw
 * endpoints supply their existing tighter byte budgets explicitly.
 */
export async function limitRequestBody(request: Request, maximumBytes = 1024 * 1024): Promise<Request | Response> {
  try {
    const bytes = await boundedRequestBytes(request, maximumBytes);
    return new Request(request, { body: bytes });
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return Response.json({ error: 'This request is too large.' }, {
      status: 413, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
    throw error;
  }
}
