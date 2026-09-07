import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // docs/job-source-discovery/pilots/apify-uae/**/*.js are one-off, already-run
  // Node research/reconciliation scripts (Apify discovery, triage, dedup,
  // staging/promotion) kept for reproducibility, not application code. The
  // package has no "type": "module", so these plain .js files are genuine
  // CommonJS by Node's default resolution and are executed directly with
  // `node <script>.js`. They rely throughout on CommonJS-only semantics —
  // require(), module.exports, require.main, __dirname — so converting them
  // to ESM would be a large, purely mechanical rewrite with no functional
  // benefit and real risk of altering already-run, already-verified behavior.
  // Scope is intentionally narrow: only this one script directory, only the
  // one rule that CommonJS requires.
  {
    files: ["docs/job-source-discovery/pilots/apify-uae/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
