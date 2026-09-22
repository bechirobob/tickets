export async function readReleaseVersion(response) {
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "missing content-type";
  const ray = response.headers.get("cf-ray");
  const context = `HTTP ${response.status}, ${contentType}${ray ? `, CF-Ray ${ray}` : ""}`;

  if (!response.ok && response.headers.get("server")?.toLowerCase() === "cloudflare" && /\b1027\b/.test(body)) {
    throw new Error(`Production verification blocked by Cloudflare Error 1027 (${context}): the Workers Free daily request quota is exhausted. It resets at 00:00 UTC. A billing-authorized Workers Paid upgrade can remove this daily limit. Redeploying or rolling back will not restore the quota.`);
  }
  if (!response.ok) throw new Error(`Production version endpoint failed (${context}).`);
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Production version endpoint did not return JSON (${context}).`);
  }

  let version;
  try {
    version = JSON.parse(body);
  } catch {
    throw new Error(`Production version endpoint returned invalid JSON (${context}).`);
  }
  if (!version || typeof version.revision !== "string" || !version.revision || typeof version.versionId !== "string" || !version.versionId) {
    throw new Error(`Production version endpoint is missing release metadata (${context}).`);
  }
  return version;
}
