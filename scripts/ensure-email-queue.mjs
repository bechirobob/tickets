const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const queueName = "becore-tickets-email-delivery";
const apiRoot = "https://api.cloudflare.com/client/v4";

if (!accountId || !token) {
  console.error("Cloudflare account credentials are required to configure the Tickets email queue.");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

async function cloudflare(path, init = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  return { response, payload };
}

const list = await cloudflare(`/accounts/${accountId}/queues`, { method: "GET" });
if (!list.response.ok || list.payload?.success !== true || !Array.isArray(list.payload?.result)) {
  console.error(JSON.stringify({
    message: "Could not inspect Tickets email queues. The deploy token needs Workers Scripts or Queues access.",
    status: list.response.status,
    errors: list.payload?.errors ?? [],
  }));
  process.exit(1);
}

let queue = list.payload.result.find((candidate) => candidate?.queue_name === queueName);
if (!queue) {
  const created = await cloudflare(`/accounts/${accountId}/queues`, {
    method: "POST",
    body: JSON.stringify({ queue_name: queueName }),
  });
  if (!created.response.ok || created.payload?.success !== true || !created.payload?.result?.queue_id) {
    console.error(JSON.stringify({
      message: "Could not create the Tickets email queue.",
      status: created.response.status,
      errors: created.payload?.errors ?? [],
    }));
    process.exit(1);
  }
  queue = created.payload.result;
}

if (!queue?.queue_id || queue?.queue_name !== queueName) {
  console.error("Tickets email queue could not be verified; refusing to continue deployment.");
  process.exit(1);
}

console.log(`Tickets email queue ready: ${queueName}.`);
