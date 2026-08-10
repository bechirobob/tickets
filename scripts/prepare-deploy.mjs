import { readFile, writeFile } from "node:fs/promises";

const generatedConfigPath = new URL("../dist/server/wrangler.json", import.meta.url);
const generatedConfig = JSON.parse(await readFile(generatedConfigPath, "utf8"));
const sourceConfigPath = new URL("../wrangler.jsonc", import.meta.url);
const sourceConfig = JSON.parse(await readFile(sourceConfigPath, "utf8"));

// vinext currently emits Wrangler's retired service-environment switch.
// Removing it preserves the modern default: each environment is its own Worker.
delete generatedConfig.legacy_env;
delete generatedConfig.configPath;
delete generatedConfig.userConfigPath;

// Keep the production hostname declarative so every deployment preserves the
// Worker Custom Domain and Cloudflare manages its DNS record and certificate.
generatedConfig.routes = sourceConfig.routes;
generatedConfig.durable_objects = sourceConfig.durable_objects;
generatedConfig.migrations = sourceConfig.migrations;

await writeFile(
  generatedConfigPath,
  `${JSON.stringify(generatedConfig)}\n`,
  "utf8",
);
