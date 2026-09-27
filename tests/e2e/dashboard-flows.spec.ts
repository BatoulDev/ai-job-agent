// Phase 11 E2E hardening: real browser clicks through every interactive
// flow Phases 07-10 built, against the real dev server and real local
// Supabase. This is the test that actually closes the "was this ever
// clicked in a browser" gap carried forward from those phases (Claude-in-
// Chrome was unavailable there; local Playwright is used here instead).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Fixture {
  email: string;
  password: string;
  matchToApproveId: string;
  matchToRejectId: string;
  matchWithDraftLetterId: string;
  matchReadyForEmailAppId: string;
  matchForMarkSentId: string;
  applicationForMarkSentId: string;
}

const fixture: Fixture = JSON.parse(readFileSync(resolve(__dirname, ".fixture.json"), "utf8"));

test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByRole("textbox", { name: "Password" }).fill(fixture.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });

  // Each Playwright test gets a fresh browser context, so the once-per-
  // session preferences reminder modal reappears every time — dismiss it
  // (purely informational, never writes to the DB) so it doesn't intercept
  // clicks on the tabs underneath it.
  const dismiss = page.getByRole("button", { name: "Not now" });
  const appeared = await dismiss
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await dismiss.click();
  }
}

async function goToTab(page: import("@playwright/test").Page, tabId: string) {
  await page.getByTestId(`tab-${tabId}`).click();
}

test("log in with the seeded fixture user and land on the dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Your job matches" })).toBeVisible();
});

test("approve a pending match from the New Matches tab", async ({ page }) => {
  await login(page);
  await goToTab(page, "new-matches");

  const card = page.getByTestId(`match-${fixture.matchToApproveId}`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();

  // Optimistic UI removes it from New Matches immediately.
  await expect(card).toHaveCount(0);

  // And it now appears under Approved.
  await goToTab(page, "approved");
  await expect(page.getByTestId(`approved-match-${fixture.matchToApproveId}`)).toBeVisible();
});

test("reject a pending match from the New Matches tab", async ({ page }) => {
  await login(page);
  await goToTab(page, "new-matches");

  const card = page.getByTestId(`match-${fixture.matchToRejectId}`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).click();
  await expect(card).toHaveCount(0);

  await goToTab(page, "rejected");
  await expect(page.getByTestId(`match-${fixture.matchToRejectId}`)).toBeVisible();
});

test("edit and approve a cover-letter draft from the Approved tab", async ({ page }) => {
  await login(page);
  await goToTab(page, "approved");

  const card = page.getByTestId(`approved-match-${fixture.matchWithDraftLetterId}`);
  await expect(card).toBeVisible();

  const textarea = card.getByRole("textbox");
  await expect(textarea).toBeVisible();
  await textarea.fill("Dear Hiring Team,\n\nThis is my own edited version of the cover letter.\n\nSincerely,");
  await card.getByRole("button", { name: "Save Draft" }).click();
  await expect(card.getByRole("button", { name: "Save Draft" })).toBeVisible(); // save completed, still editable

  await card.getByRole("button", { name: "Approve Cover Letter" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await expect(card.getByText("This is my own edited version")).toBeVisible();
});

test("preview and approve & send an email application from the Approved tab", async ({ page }) => {
  await login(page);
  await goToTab(page, "approved");

  const card = page.getByTestId(`approved-match-${fixture.matchReadyForEmailAppId}`);
  await expect(card).toBeVisible();

  // Preview shows the real recipient/subject/body before any send happens.
  await expect(card.getByText("jobs@e2e-fixture.test")).toBeVisible();
  await expect(card.getByText(/Application for .* at E2E Fixture Co/)).toBeVisible();
  await expect(card.getByText("Approved cover letter body for the platform role.").first()).toBeVisible();

  await card.getByRole("button", { name: "Approve & Send Application" }).click();

  // The explicit approval gate created the application — status is Pending
  // (nothing auto-sends it; that's the internal worker's separate job).
  await expect(card.getByText("Pending", { exact: true })).toBeVisible();
  await expect(card.getByText("Waiting to be sent to jobs@e2e-fixture.test.")).toBeVisible();
});

test("mark an external-link application as sent, then report an outcome on the Sent tab", async ({ page }) => {
  await login(page);
  await goToTab(page, "approved");

  const card = page.getByTestId(`approved-match-${fixture.matchForMarkSentId}`);
  await expect(card).toBeVisible();
  await expect(card.getByText("Pending", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "I've applied — mark as sent" }).click();
  await expect(card.getByText("Sent", { exact: true })).toBeVisible();

  await goToTab(page, "sent");
  const sentCard = page.getByTestId(`sent-application-${fixture.applicationForMarkSentId}`);
  await expect(sentCard).toBeVisible();
  await expect(sentCard.getByText("No update yet")).toBeVisible();

  await sentCard.getByRole("button", { name: "Interviewing" }).click();
  await expect(sentCard.getByText("Interviewing", { exact: true }).first()).toBeVisible();
});
