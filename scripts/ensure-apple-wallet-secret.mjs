import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const secretName = "APPLE_WALLET_AUTH_SECRET";
const listed = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json"], {
  encoding: "utf8",
  env: process.env,
});
if (listed.status !== 0) {
  console.error(listed.stderr || "Could not inspect Worker secrets.");
  process.exit(1);
}
const names = new Set(JSON.parse(listed.stdout).map((item) => item.name));
if (names.has(secretName)) {
  console.log("Apple Wallet update authentication secret already exists.");
  process.exit(0);
}
const value = randomBytes(32).toString("base64url");
const written = spawnSync("npx", ["wrangler", "secret", "put", secretName], {
  input: `${value}\n`,
  encoding: "utf8",
  env: process.env,
});
if (written.status !== 0) {
  console.error(written.stderr || `Could not configure ${secretName}.`);
  process.exit(1);
}
console.log("Apple Wallet update authentication secret provisioned without exposing key material.");
