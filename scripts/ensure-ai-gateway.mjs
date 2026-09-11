import {
  TICKETS_AI_GATEWAY_ID,
  TICKETS_AI_SPEND_LIMITS,
  hasRequiredTicketsSpendLimits,
} from "./ai-gateway-policy.mjs";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const gatewayId = TICKETS_AI_GATEWAY_ID;
const apiRoot = "https://api.cloudflare.com/client/v4";

if (!accountId || !token) {
  console.error("Cloudflare account credentials are required to configure the Tickets AI Gateway.");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

const desired = {
  id: gatewayId,
  cache_invalidate_on_update: true,
  cache_ttl: 0,
  collect_logs: true,
  rate_limiting_interval: 0,
  rate_limiting_limit: 0,
  rate_limiting_technique: "sliding",
  retry_backoff: "constant",
  retry_delay: 0,
  retry_max_attempts: 1,
  // The upstream OpenAI key remains a Worker secret and is sent on each request.
  // Gateway auth can be tightened later with a dedicated AI Gateway Run token;
  // never reuse the broader deployment token at runtime.
  authentication: false,
  workers_ai_billing_mode: "postpaid",
  spend_limits: TICKETS_AI_SPEND_LIMITS,
};

async function cloudflare(path, init = {}) {
  const response = await fetch(`${apiRoot}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  return { response, payload };
}

const gatewayPath = `/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`;
const current = await cloudflare(gatewayPath, { method: "GET" });

let configured;
if (current.response.status === 404) {
  configured = await cloudflare(`/accounts/${accountId}/ai-gateway/gateways`, {
    method: "POST",
    body: JSON.stringify(desired),
  });
} else if (current.response.ok && current.payload?.success) {
  configured = await cloudflare(gatewayPath, {
    method: "PUT",
    body: JSON.stringify(desired),
  });
} else {
  console.error(JSON.stringify({
    message: "Could not inspect Tickets AI Gateway. The deploy token may need AI Gateway Edit permission.",
    status: current.response.status,
    errors: current.payload?.errors ?? [],
  }));
  process.exit(1);
}

if (!configured.response.ok || configured.payload?.success !== true) {
  console.error(JSON.stringify({
    message: "Could not configure Tickets AI Gateway. Production AI will remain fail-closed.",
    status: configured.response.status,
    errors: configured.payload?.errors ?? [],
  }));
  process.exit(1);
}

// Cloudflare's create/update response is not guaranteed to echo all nested spend
// rules. Re-read the persisted Gateway and validate the state that will actually
// serve production traffic. A few short reads tolerate control-plane propagation
// without ever weakening the fail-closed budget requirement.
let verified = false;
let lastVerification = null;
for (const delayMs of [0, 250, 750, 1_500]) {
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const verification = await cloudflare(gatewayPath, { method: "GET" });
  lastVerification = verification;
  if (
    verification.response.ok
    && verification.payload?.success === true
    && hasRequiredTicketsSpendLimits(verification.payload.result)
  ) {
    verified = true;
    break;
  }
}

if (!verified) {
  console.error(JSON.stringify({
    message: "Tickets AI Gateway persisted without the required spend limits; refusing to continue deployment.",
    status: lastVerification?.response?.status ?? null,
    errors: lastVerification?.payload?.errors ?? [],
  }));
  process.exit(1);
}

console.log("Tickets AI Gateway ready: $5/24h, $25/30d, $1/user/24h; provider retries capped at one attempt.");
