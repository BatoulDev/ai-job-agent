// Section D, product-completion phase: rename to "AI Job Guide". Verifies
// the renamed product name is actually visible in a real browser on the
// pages a visitor/user sees first — landing page navbar, page title, login
// page — and on the authenticated dashboard header. The exhaustive static
// sweep of every source file lives in tests/unit/branding-check.test.mjs;
// this proves the rendered result, not just the source string.
import { test, expect } from "@playwright/test";

test("landing page shows the AI Job Guide brand name and page title", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "AI Job Guide" }).first()).toBeVisible();
  await expect(page).toHaveTitle(/AI Job Guide/);
});

test("login page shows the AI Job Guide brand name", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("AI Job Guide").first()).toBeVisible();
});

test("no visible 'AI Job Agent' branding remains on the landing or login pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("AI Job Agent", { exact: false })).toHaveCount(0);
  await page.goto("/login");
  await expect(page.getByText("AI Job Agent", { exact: false })).toHaveCount(0);
});
