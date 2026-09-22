// Read only: credential names/presence and counts, never credential values or rows.
const account = 'af75a230de2eea882606db8d9acce473';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Cloudflare operator connection is missing.');
async function read(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const value = await response.json();
  if (!response.ok || !value.success) throw new Error(`Read-only preflight failed (${response.status}, ${value.errors?.map(error => error.code).join(',')}).`);
  return value.result;
}
const settings = await read('/workers/scripts/becore-tickets/settings');
const secrets = settings.bindings.filter(binding => binding.type === 'secret_text').map(binding => binding.name).sort();
const missing = secrets.filter(name => !process.env[name]);
const databases = settings.bindings.filter(binding => binding.type === 'd1').map(binding => ({ name: binding.name, id: binding.id }));
const rooms = settings.bindings.filter(binding => binding.type === 'durable_object_namespace').map(binding => ({ name: binding.name, namespaceId: binding.namespace_id }));
const probe = await fetch('https://tickets.becoreops.com/api/version', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
const body = await probe.text();
console.log(JSON.stringify({ readOnly: true, workerStatus: probe.status, quotaExhausted: /1027|plan limits|exceeded.*limit/i.test(body), privateBindingNames: secrets, missingRunnerCredentialNames: missing, databases, rooms }, null, 2));
