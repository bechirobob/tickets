import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const enabled = config.vars?.SEEV_ENABLED === "true";
const environment = config.vars?.SEEV_ENVIRONMENT;

if (!enabled) {
  console.log("SeeV production checkout remains disabled.");
  process.exit(0);
}

if (environment !== "production") {
  console.error("SEEV_ENABLED=true requires SEEV_ENVIRONMENT=production for the production Worker.");
  process.exit(1);
}

const listed = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json"], {
  encoding: "utf8",
  env: process.env,
});
if (listed.status !== 0) {
  console.error(listed.stderr || "Could not inspect Worker secrets.");
  process.exit(1);
}

const names = new Set(JSON.parse(listed.stdout).map((item) => item.name));
const required = ["SEEV_CHECKOUT_API_KEY", "SEEV_WEBHOOK_SECRET"];
const missing = required.filter((name) => !names.has(name));
if (missing.length) {
  console.error(`SeeV production cutover blocked. Missing Worker secrets: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("SeeV production configuration gate passed: production environment plus checkout and webhook secrets are present.");
