import { readFile, writeFile } from "node:fs/promises";

const generatedConfigPath = new URL("../dist/server/wrangler.json", import.meta.url);
const generatedConfig = JSON.parse(await readFile(generatedConfigPath, "utf8"));

// vinext currently emits Wrangler's retired service-environment switch.
// Removing it preserves the modern default: each environment is its own Worker.
delete generatedConfig.legacy_env;

await writeFile(
  generatedConfigPath,
  `${JSON.stringify(generatedConfig)}\n`,
  "utf8",
);
