// Minimal .env.local loader for Playwright's Node processes (globalSetup/
// globalTeardown/config), which do not auto-load env files the way `next
// dev` does. No new dependency — this project already has several plain
// Node scripts that read `.env.local` directly; this mirrors that
// convention rather than adding dotenv for a dozen lines of parsing.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvLocal(): void {
  const path = resolve(__dirname, "../../.env.local");
  if (!existsSync(path)) return;

  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
