function base64Url(bytes: Uint8Array | string) {
  const binary =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let value = "";
  for (const byte of binary) value += String.fromCharCode(byte);
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function importPrivateKey(pem: string) {
  const normalized = pem
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/gu, "");
  const raw = Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function googleWalletUrl(
  config: {
    issuerId: string;
    classId: string;
    email: string;
    privateKey: string;
    origin: string;
  },
  ticket: {
    id: string;
    holder: string;
    title: string;
    startsAt: string;
    endsAt: string;
    venue: string;
    area: string;
    qrPayload: string;
    ticketType: string;
  },
) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const objectId = `${config.issuerId}.${ticket.id.replace(/[^A-Za-z0-9._-]/gu, "_")}`;
  const claims = {
    iss: config.email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [config.origin],
    payload: {
      eventTicketObjects: [
        {
          id: objectId,
          classId: config.classId,
          state: "ACTIVE",
          ticketHolderName: ticket.holder,
          ticketNumber: ticket.id,
          barcode: {
            type: "QR_CODE",
            value: ticket.qrPayload,
            alternateText: ticket.id.slice(-8).toUpperCase(),
          },
          textModulesData: [
            { id: "ticket_type", header: "TICKET", body: ticket.ticketType },
            {
              id: "venue",
              header: "VENUE",
              body: `${ticket.venue}, ${ticket.area}`,
            },
          ],
          validTimeInterval: {
            start: { date: ticket.startsAt },
            end: { date: ticket.endsAt },
          },
        },
      ],
    },
  };
  const payload = base64Url(JSON.stringify(claims));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importPrivateKey(config.privateKey),
    new TextEncoder().encode(input),
  );
  return `https://pay.google.com/gp/v/save/${input}.${base64Url(new Uint8Array(signature))}`;
}
