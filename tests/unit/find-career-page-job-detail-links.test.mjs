// Unit tests for src/lib/ingestion/findCareerPageJobDetailLinks.ts (Phase 16).
// Pure logic, no network — real-shaped HTML fixtures.
// Run: node --test tests/unit/find-career-page-job-detail-links.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findCareerPageJobDetailLinks } from "../../src/lib/ingestion/findCareerPageJobDetailLinks.ts";

describe("findCareerPageJobDetailLinks", () => {
  test("finds same-domain job-detail links and ignores unrelated nav/footer links", () => {
    const html = `
      <nav><a href="/about">About</a><a href="/contact">Contact</a></nav>
      <main>
        <a href="/careers/senior-accountant-4821">Senior Accountant</a>
        <a href="/careers/marketing-manager-4822">Marketing Manager</a>
      </main>
      <footer><a href="https://linkedin.com/company/acme">LinkedIn</a></footer>
    `;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, ["https://acme.example/careers/senior-accountant-4821", "https://acme.example/careers/marketing-manager-4822"]);
  });

  test("excludes the landing/category page itself even when its own path matches the job-ish pattern", () => {
    const html = `<a href="/careers">All Openings</a><a href="/careers/">All Openings</a><a href="/careers?dept=eng">Engineering</a>`;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, []);
  });

  test("never follows a link to a different domain", () => {
    const html = `<a href="https://other-company.example/careers/job-1234">Job</a>`;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, []);
  });

  test("ignores mailto/tel/javascript/hash links", () => {
    const html = `
      <a href="mailto:jobs@acme.example">Email us</a>
      <a href="tel:+9611234567">Call</a>
      <a href="javascript:void(0)">Apply</a>
      <a href="#top">Back to top</a>
    `;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, []);
  });

  test("resolves relative hrefs against the page URL", () => {
    const html = `<a href="job/backend-engineer-7712">Backend Engineer</a>`;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers/" });
    assert.deepEqual(links, ["https://acme.example/careers/job/backend-engineer-7712"]);
  });

  test("matches a trailing numeric ID pattern even without a job/career path segment (real Oracle/Workday-style URLs)", () => {
    const html = `<a href="/openings/12345">Opening</a>`;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, ["https://acme.example/openings/12345"]);
  });

  test("is bounded by maxLinks, never unbounded (AGENTS.md §26/§27)", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<a href="/careers/job-${i}">Job ${i}</a>`).join("\n");
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers", maxLinks: 3 });
    assert.equal(links.length, 3);
  });

  test("deduplicates identical resolved URLs", () => {
    const html = `<a href="/careers/job-1">Job 1</a><a href="/careers/job-1">Job 1 (dup)</a>`;
    const links = findCareerPageJobDetailLinks(html, { pageUrl: "https://acme.example/careers" });
    assert.deepEqual(links, ["https://acme.example/careers/job-1"]);
  });

  test("returns an empty array for empty/malformed input, never throws", () => {
    assert.deepEqual(findCareerPageJobDetailLinks("", { pageUrl: "https://acme.example/careers" }), []);
    assert.deepEqual(findCareerPageJobDetailLinks("<html></html>", { pageUrl: "not-a-valid-url" }), []);
  });
});
