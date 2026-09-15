import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const enabled = config.vars?.SEEV_ENABLED === "true";
const environment = config.vars?.SEEV_ENVIRONMENT;

if (!enabled) {
  console.log("SeeV production checkout remains disabled.");
} else {
  if (environment !== "production") {
    throw new Error("SEEV_ENABLED=true requires SEEV_ENVIRONMENT=production for the production Worker.");
  }

  const listed = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json"], {
    encoding: "utf8",
    env: process.env,
  });
  if (listed.status !== 0) {
    throw new Error(listed.stderr || "Could not inspect Worker secrets.");
  }

  const names = new Set(JSON.parse(listed.stdout).map((item) => item.name));
  const required = ["SEEV_CHECKOUT_API_KEY", "SEEV_WEBHOOK_SECRET"];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) {
    throw new Error(`SeeV production cutover blocked. Missing Worker secrets: ${missing.join(", ")}`);
  }

  console.log("SeeV production configuration gate passed: production environment plus checkout and webhook secrets are present.");
}
