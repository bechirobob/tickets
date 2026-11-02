import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // These CommonJS entry points support pinned upstream callers.
  { files: ["vendor/tooling-glob/*.cjs", "vendor/minimatch-compat/index.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
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

