import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const secretName = "STAFF_LOGIN_DECOY_SECRET";
const wrangler = new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url).pathname;
const listed = spawnSync(process.execPath, [wrangler, "secret", "list", "--format", "json"], { encoding: "utf8" });
if (listed.status !== 0) {
  console.error("Could not inspect the Worker secret names. Deployment stopped.");
  process.exit(1);
}
const secrets = JSON.parse(listed.stdout);
if (secrets.some((item) => item.name === secretName)) {
  console.log("Staff login privacy key already exists.");
} else {
  const written = spawnSync(process.execPath, [wrangler, "secret", "put", secretName], {
    input: `${randomBytes(32).toString("base64url")}\n`,
    encoding: "utf8",
  });
  if (written.status !== 0) {
    console.error("Could not provision the staff login privacy key. Deployment stopped.");
    process.exit(1);
  }
  console.log("Staff login privacy key provisioned.");
}
