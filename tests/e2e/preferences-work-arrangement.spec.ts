// Section A, product-completion phase: Flexible work-arrangement UX.
// Flexible is a real, explicit user preference ("open to remote, hybrid,
// and on-site") — never to be confused with a job's unknown/unspecified
// arrangement, which is a separate concept entirely (see
// docs/PRODUCT_MATCHING_RULES.md "Work arrangement"). This spec proves the
// UI-testable half of that contract end to end: the option is visible,
// its helper text explains the benefit without pressure/guarantees, the
// choice actually saves and survives a reload, and Remote/Hybrid/On-site
// are unaffected regressions. The backend-only half (Flexible reaching
// real matching against remote/hybrid/onsite jobs; an unknown job
// arrangement staying neutral) is proven at the DB/unit level —
// tests/db/matching-rerank.test.mjs's "a real persisted 'flexible'
// preference matches real remote, hybrid, and onsite jobs alike", and
// tests/unit/check-job-eligibility.test.mjs's Flexible combinatorial
// coverage plus its existing "unknown" branch tests — not duplicated here
// since Playwright cannot exercise the real LLM rerank path.
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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByRole("textbox", { name: "Password" }).fill(fixture.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/onboarding\/upload-cv|\/dashboard/, { timeout: 15_000 });
  await page.goto("/onboarding/preferences");
  await expect(page.getByRole("heading", { name: /preferences/i })).toBeVisible({ timeout: 10_000 });
}

async function clickRadioLabel(page: import("@playwright/test").Page, groupName: string, optionText: string) {
  await page.getByRole("radiogroup", { name: groupName }).locator("label", { hasText: optionText }).click();
}

async function fillRequiredFieldsAndSave(page: import("@playwright/test").Page, arrangementLabel: string) {
  // Target roles only need selecting once per page load — reload clears
  // it, so each test (including the reload test, after its own reload)
  // must re-select it before a save can succeed.
  const targetRolesCombo = page.getByPlaceholder("Search roles...");
  if (await targetRolesCombo.isVisible().catch(() => false)) {
    await targetRolesCombo.click();
    await page.getByRole("option").first().click();
    await page.keyboard.press("Escape");
  }

  await clickRadioLabel(page, "Work arrangement", arrangementLabel);

  if (arrangementLabel !== "Remote") {
    // Remote never shows the Lebanese-location combobox (see
    // requiresLocation in page.tsx); on-site/hybrid/flexible all do and
    // require at least one selection before submit.
    const locationCombo = page.getByPlaceholder("Search locations...");
    if (await locationCombo.isVisible().catch(() => false)) {
      await locationCombo.click();
      await page.getByRole("option").first().click();
      await page.keyboard.press("Escape");
    }
  }

  await clickRadioLabel(page, "How closely should we follow your selected Lebanese locations?", "Anywhere in Lebanon");
  await page.getByLabel("Job type").selectOption({ label: "Full-time" });
  await page.getByLabel("Experience level").selectOption({ label: "Junior" });

  const rpcResponse = page.waitForResponse((res) => res.url().includes("/rest/v1/rpc/save_job_preferences") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Save & Review AI Profile" }).click();
  const response = await rpcResponse;
  expect(response.ok()).toBe(true);
  await page.waitForURL(/\/onboarding\/upload-cv|\/dashboard/, { timeout: 15_000 });
}

test("Flexible: visible, has an explanatory (not pressuring) helper note, saves correctly, and survives a reload", async ({ page }) => {
  await login(page);

  // 1. Flexible option is visible.
  const flexibleRadio = page.getByRole("radiogroup", { name: "Work arrangement" }).getByRole("radio", { name: "Flexible" });
  await expect(flexibleRadio).toBeVisible();

  await clickRadioLabel(page, "Work arrangement", "Flexible");

  // 2. Helper message is visible, explains the benefit, and does not
  // pressure the user or promise guaranteed results.
  const helperText = page.getByText(/open to remote, hybrid, and on-site opportunities/i);
  await expect(helperText).toBeVisible();
  const helperContent = (await helperText.textContent())!;
  expect(helperContent).toMatch(/help you discover more relevant matches/i);
  expect(helperContent).not.toMatch(/guarantee|promise|100%|best/i);

  // 3. Selecting Flexible saves correctly (requires the Lebanese-location
  // combobox, like on-site/hybrid).
  await fillRequiredFieldsAndSave(page, "Flexible");

  const { data: prefs, error } = await admin.from("job_preferences").select("work_arrangement").eq("user_id", fixture.userId).single();
  expect(error).toBeNull();
  // 5. Backend receives the correct value.
  expect(prefs?.work_arrangement).toBe("flexible");

  // 4. Reload preserves Flexible — re-navigate (a real full reload) and
  // confirm the radio still reflects the persisted value.
  await page.goto("/onboarding/preferences");
  await expect(page.getByRole("heading", { name: /preferences/i })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("radiogroup", { name: "Work arrangement" }).getByRole("radio", { name: "Flexible" })).toBeChecked();
});

for (const label of ["Remote", "On-site", "Hybrid"]) {
  test(`${label}: still saves and persists correctly (no regression from the Flexible UX change)`, async ({ page }) => {
    await login(page);
    await fillRequiredFieldsAndSave(page, label);

    const expectedValue = { Remote: "remote", "On-site": "onsite", Hybrid: "hybrid" }[label];
    const { data: prefs, error } = await admin.from("job_preferences").select("work_arrangement").eq("user_id", fixture.userId).single();
    expect(error).toBeNull();
    expect(prefs?.work_arrangement).toBe(expectedValue);
  });
}
