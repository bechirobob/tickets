import assert from "node:assert/strict";
import test from "node:test";
import { readReleaseVersion } from "../scripts/release-version-response.mjs";

test("accepts release metadata for exact revision verification", async () => {
  const version = { service: "becore-tickets", revision: "release-sha", versionId: "worker-version" };
  assert.deepEqual(await readReleaseVersion(Response.json(version)), version);
});

test("identifies a Cloudflare daily quota block without exposing the HTML body", async () => {
  const response = new Response("<html><span>Error 1027</span><footer>private visitor detail</footer></html>", {
    status: 429, headers: { server: "cloudflare", "content-type": "text/html", "cf-ray": "test-ray" },
  });
  await assert.rejects(readReleaseVersion(response), error => {
    assert.match(error.message, /Error 1027.*HTTP 429.*CF-Ray test-ray/);
    assert.match(error.message, /00:00 UTC/);
    assert.match(error.message, /Redeploying or rolling back will not restore/);
    assert.doesNotMatch(error.message, /private visitor detail/);
    return true;
  });
});

test("reports other failures without misclassifying a generic rate limit", async () => {
  await assert.rejects(readReleaseVersion(new Response("rate limited", { status: 429 })), /endpoint failed \(HTTP 429/);
  await assert.rejects(readReleaseVersion(new Response("upstream failure", { status: 503 })), /endpoint failed \(HTTP 503/);
});

test("rejects HTML and malformed JSON with actionable diagnostics", async () => {
  await assert.rejects(readReleaseVersion(new Response("<html>challenge</html>", { headers: { "content-type": "text/html" } })), /did not return JSON/);
  await assert.rejects(readReleaseVersion(new Response("{", { headers: { "content-type": "application/json" } })), /invalid JSON/);
});

test("cannot mistake an error payload or absent release metadata for a deployment", async () => {
  for (const payload of [null, {}, { error: "unavailable" }, { revision: "release-sha" }, { revision: "", versionId: "worker-version" }]) {
    await assert.rejects(readReleaseVersion(Response.json(payload)), /missing release metadata/);
  }
});
