import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // This bounded adapter must remain require-compatible with both upstream callers.
  { files: ["vendor/tooling-glob/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "mobile/**",
    ".vps-build/**",
    "dist-vps/**",
    "vps-state/**",
    // Retained upstream distributions were previously excluded under node_modules.
    "vendor/eslint-plugin-next/dist/**",
    "vendor/vite-plugin-dynamic-import/dist/**",
  ]),
]);

export default eslintConfig;

