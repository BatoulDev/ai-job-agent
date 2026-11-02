// Founder-evidence E2E (2026-11-02 checkpoint): read-only screenshot
// capture of the real running app for the visual evidence report. Reuses
// the shared dashboard-flows fixture (tests/e2e/.fixture.json) — must run
// as part of the same Playwright invocation as dashboard-flows.spec.ts so
// global-setup has already seeded it. Takes no mutating action of its own;
// runs last (alphabetically after dashboard-flows) so the fixture's own
// approve/reject/cover-letter/application states are already visible.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Fixture {
  email: string;
  password: string;
}

const fixture: Fixture = JSON.parse(readFileSync(resolve(__dirname, ".fixture.json"), "utf8"));
const SHOT_DIR = resolve(__dirname, "..", "..", "test-fixtures", "e2e-evidence-output");

test("screenshot gallery: dashboard tabs and settings pages", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByRole("textbox", { name: "Password" }).fill(fixture.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  const dismiss = page.getByRole("button", { name: "Not now" });
  const appeared = await dismiss.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false);
  if (appeared) await dismiss.click();

  await expect(page.getByRole("heading", { name: "Your job matches" })).toBeVisible();
  await page.screenshot({ path: resolve(SHOT_DIR, "gallery-01-dashboard-new-matches.png"), fullPage: true });

  await page.getByTestId("tab-approved").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOT_DIR, "gallery-02-dashboard-approved.png"), fullPage: true });

  await page.getByTestId("tab-sent").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(SHOT_DIR, "gallery-03-dashboard-sent.png"), fullPage: true });

  await page.goto("/settings/profile");
  await page.screenshot({ path: resolve(SHOT_DIR, "gallery-04-settings-profile.png"), fullPage: true });

  await page.goto("/settings/delete-account");
  await page.screenshot({ path: resolve(SHOT_DIR, "gallery-05-delete-account.png"), fullPage: true });
});
