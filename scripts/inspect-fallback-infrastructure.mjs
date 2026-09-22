// Read-only preflight. Never print credentials or unfiltered provider responses.
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Cloudflare operator connection is missing.');
async function read(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) return { available: false, status: response.status, codes: data.errors?.map(e => e.code) };
  return { available: true, result: data.result };
}
const zones = await read('/zones?name=becoreops.com');
const report = { readOnly: true, revision: process.env.GITHUB_SHA, tailnetCredentialsPresent: Boolean(process.env.TS_OAUTH_CLIENT_ID && process.env.TS_OAUTH_SECRET) };
if (!zones.available || zones.result.length !== 1) {
  report.zone = { available: false, status: zones.status, codes: zones.codes, matches: zones.result?.length };
} else {
  const zone = zones.result[0];
  report.zone = { id: zone.id, name: zone.name, plan: zone.plan?.name };
  const rules = await read(`/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`);
  report.redirects = rules.available ? { available: true, id: rules.result.id, rules: rules.result.rules?.map(r => ({ id: r.id, ref: r.ref, enabled: r.enabled })) } : rules;
  const dns = await read(`/zones/${zone.id}/dns_records?name=tickets-status.becoreops.com`);
  report.fallbackDns = dns.available ? { available: true, records: dns.result.map(r => ({ id: r.id, type: r.type, name: r.name, content: r.content, proxied: r.proxied })) } : dns;
}
console.log(JSON.stringify(report, null, 2));
