// Unit tests for src/lib/applications/preview.ts's buildApplicationPreview
// (Phase 09). Pure logic, no DB, no network, no AI call — the preview never
// invents content, it only reflects already-approved data.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildApplicationPreview } from "../../src/lib/applications/preview.ts";

describe("buildApplicationPreview", () => {
  const externalLinkJob = {
    title: "Backend Engineer",
    companyName: "Acme",
    applicationMethod: "external_link",
    applicationUrl: "https://example.test/apply",
    applicationEmail: null,
  };
  const emailJob = {
    title: "Backend Engineer",
    companyName: "Acme",
    applicationMethod: "email",
    applicationUrl: null,
    applicationEmail: "jobs@acme.test",
  };
  const approvedLetter = { approvalStatus: "user_approved", approvedContent: "Dear Hiring Team,\n\nMy pitch.\n\nSincerely," };

  test("external_link job returns the apply URL, no cover letter needed", () => {
    const preview = buildApplicationPreview(externalLinkJob, null);
    assert.deepEqual(preview, { method: "external_link", blocked: false, applyUrl: "https://example.test/apply" });
  });

  test("external_link job throws if the job is missing its own application_url (data problem, not a user error)", () => {
    assert.throws(() => buildApplicationPreview({ ...externalLinkJob, applicationUrl: null }, null));
  });

  test("email job with an approved cover letter returns recipient/subject/body verbatim from the approved content", () => {
    const preview = buildApplicationPreview(emailJob, approvedLetter);
    assert.equal(preview.method, "email");
    assert.equal(preview.recipientEmail, "jobs@acme.test");
    assert.equal(preview.subject, "Application for Backend Engineer at Acme");
    assert.equal(preview.body, approvedLetter.approvedContent);
  });

  test("email job with no cover letter is blocked with a clear reason, never a fabricated body", () => {
    const preview = buildApplicationPreview(emailJob, null);
    assert.equal(preview.blocked, true);
    assert.match(preview.reason, /Approve your cover letter/);
  });

  test("email job with only a draft (unapproved) cover letter is blocked", () => {
    const preview = buildApplicationPreview(emailJob, { approvalStatus: "draft", approvedContent: null });
    assert.equal(preview.blocked, true);
  });

  test("email job with no application_email on file is blocked", () => {
    const preview = buildApplicationPreview({ ...emailJob, applicationEmail: null }, approvedLetter);
    assert.equal(preview.blocked, true);
    assert.match(preview.reason, /no application email/);
  });
});
