import { CHECKOUT_PREVIEW_METHODS, checkoutPreviewIsOpen, checkoutPreviewMessages, type CheckoutPreviewMethod } from "../../../../lib/checkout-preview";

// Deliberately no database, runtime binding, analytics or payment-provider imports.
// Only an enum leaves the browser; this endpoint never creates an order or URL.
const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  if (!checkoutPreviewIsOpen()) return respond({ error: "This temporary checkout preview has ended." }, 410);
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond({ error: "This preview request was not accepted." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond({ error: "Send a preview payment method." }, 400);

  let value: unknown;
  try {
    // Bound the entire body, including chunked requests, before decoding it.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 128) {
        await reader.cancel();
        return respond({ error: "Send only a preview payment method." }, 400);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return respond({ error: "Send a preview payment method." }, 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return respond({ error: "Choose a preview payment method." }, 400);
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !CHECKOUT_PREVIEW_METHODS.includes(body.paymentMethod as CheckoutPreviewMethod)) {
    return respond({ error: "Send only a supported preview payment method." }, 400);
  }
  return respond({ simulated: true, message: checkoutPreviewMessages[body.paymentMethod as CheckoutPreviewMethod] });
}
