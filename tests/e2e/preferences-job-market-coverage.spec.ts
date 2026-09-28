// Task: job_market_coverage wiring fix. Real-browser proof (not just static
// code reading) of the UI -> save_job_preferences RPC -> DB path for a Pro
// user choosing work_arrangement=remote + international search enabled +
// willing_to_relocate=false. Uses the .fixture-job-market-coverage.json
// user seeded by global-setup.ts (Pro plan, profile pre-filled, no
// job_preferences row yet) so this test drives the real onboarding form
// end to end, including the target-role combobox, rather than relying on
// pre-seeded preference data.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

interface Fixture {
  email: string;
  password: string;
  userId: string;
}

const fixture: Fixture = JSON.parse(
  readFileSync(resolve(__dirname, ".fixture-job-market-coverage.json"), "utf8")
);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } }
);

test("Pro user selecting Remote + international search Yes + willing to relocate No persists via the real RPC", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByRole("textbox", { name: "Password" }).fill(fixture.password);
  await page.getByRole("button", { name: "Log in" }).click();
  // This fixture user has no CV, so post-login routing lands on
  // /onboarding/upload-cv (see src/lib/entitlements/onboardingStep.ts) —
  // navigate to /onboarding/preferences directly, which this page allows
  // to be visited independently of CV state.
  await page.waitForURL(/\/onboarding\/upload-cv|\/dashboard/, { timeout: 15_000 });

  await page.goto("/onboarding/preferences");
  await expect(page.getByRole("heading", { name: /preferences/i })).toBeVisible({ timeout: 10_000 });

  // Target roles (required, no default) — drive the real combobox.
  await page.getByPlaceholder("Search roles...").click();
  await page.getByRole("option").first().click();
  await page.keyboard.press("Escape");

  // These radios' inputs are visually hidden ("sr-only") with the clickable
  // surface on the wrapping <label> — clicking the input locator directly
  // hits Playwright actionability issues (the sr-only inputs collapse to
  // overlapping coordinates), so click the label by its visible text.
  async function clickRadioLabel(groupName: string, optionText: string) {
    await page.getByRole("radiogroup", { name: groupName }).locator("label", { hasText: optionText }).click();
  }

  // Work arrangement: Remote.
  await clickRadioLabel("Work arrangement", "Remote");

  // Lebanon location-scope is a required field regardless of work
  // arrangement (see handleSubmit's lebanonLocationScope check).
  await clickRadioLabel("How closely should we follow your selected Lebanese locations?", "Anywhere in Lebanon");

  // Job type / experience level — required selects with no default.
  await page.getByLabel("Job type").selectOption({ label: "Full-time" });
  await page.getByLabel("Experience level").selectOption({ label: "Junior" });

  // International job search: Yes (Pro-only section).
  await clickRadioLabel("Would you like us to search for jobs outside Lebanon?", "Yes");

  // Willing to relocate: No.
  await clickRadioLabel("Are you willing to relocate outside Lebanon for the right opportunity?", "No");

  const rpcResponse = page.waitForResponse((res) => res.url().includes("/rest/v1/rpc/save_job_preferences") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Save & Review AI Profile" }).click();
  const response = await rpcResponse;
  expect(response.ok()).toBe(true);

  // This fixture user still has no CV, so a successful save routes back
  // into onboarding (upload-cv) rather than /dashboard — the RPC response
  // assertion above is what proves the save itself succeeded.
  await page.waitForURL(/\/onboarding\/upload-cv|\/dashboard/, { timeout: 15_000 });

  const { data: prefs, error } = await admin
    .from("job_preferences")
    .select("work_arrangement, international_search_enabled, willing_to_relocate, job_market_coverage")
    .eq("user_id", fixture.userId)
    .single();
  expect(error).toBeNull();
  expect(prefs?.work_arrangement).toBe("remote");
  expect(prefs?.international_search_enabled).toBe(true);
  expect(prefs?.willing_to_relocate).toBe(false);

  // Fixed by supabase/migrations/20260930110000_derive_job_market_coverage_server_side.sql:
  // save_job_preferences now derives job_market_coverage server-side from
  // international_search_enabled + work_arrangement (never accepts it from
  // the client). This Pro + remote + international-enabled combination
  // derives 'remote_worldwide' regardless of willing_to_relocate. Real,
  // observed "after" behavior captured via a live browser + RPC + DB
  // round-trip.
  expect(prefs?.job_market_coverage).toBe("remote_worldwide");
});
