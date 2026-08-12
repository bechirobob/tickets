import { applyDeliveryWebhook } from "../../../../lib/email-delivery";

function decodeBase64(value: string) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function validSignature(raw: string, id: string, timestamp: string, signatureHeader: string, secret: string) {
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: ArrayBuffer;
  try { secretBytes = decodeBase64(encodedSecret); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  const candidates = signatureHeader.split(" ").map((part) => part.startsWith("v1,") ? part.slice(3) : "").filter(Boolean);
  return candidates.some((candidate) => {
    try {
      const received = new Uint8Array(decodeBase64(candidate));
      if (received.length !== expected.length) return false;
      let difference = 0;
      for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ received[index];
      return difference === 0;
    } catch { return false; }
  });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.RESEND_WEBHOOK_SECRET) return new Response("Unavailable", { status: 503 });
  const raw = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!id || !(await validSignature(raw, id, timestamp, signature, env.RESEND_WEBHOOK_SECRET))) return new Response("Invalid signature", { status: 401 });
  const payload = JSON.parse(raw) as { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string }; failed?: { reason?: string } } };
  if (!payload.type || !payload.data?.email_id) return new Response("OK");
  await applyDeliveryWebhook(env.DB, {
    providerId: payload.data.email_id,
    type: payload.type,
    eventAt: payload.created_at ?? null,
    detail: payload.data.bounce?.message ?? payload.data.failed?.reason ?? null,
  });
  return new Response("OK");
}
