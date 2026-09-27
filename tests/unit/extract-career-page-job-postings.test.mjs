// Unit tests for src/lib/ingestion/extractCareerPageJobPostings.ts (Phase
// 13, Tier B). Pure, no network.
//
// FIXTURE-ONLY, not live-verified this phase: a live check against 11 real
// company_sources rows with automation_eligibility=
// 'suitable_public_html_subject_to_review' (Byblos Bank, touch Lebanon,
// Caritas Lebanon, Lebanese Red Cross, KPMG, Anghami, Whish Money, Mercy
// Corps, Deloitte, EY, Bank Audi) found ZERO of their recorded
// official_careers_url pages emitting schema.org JobPosting JSON-LD
// directly — see docs/PROVIDER_EXPANSION_IMPLEMENTATION.md for the full
// finding. This is expected: JobPosting markup typically lives on an
// individual job's own detail page, not a careers landing/overview page,
// and official_careers_url in the registry is almost always the latter.
// The fixtures below use the real, standard schema.org JobPosting shape
// (https://schema.org/JobPosting, the same markup Google for Jobs
// consumes) — proving the extractor's logic is correct against the real
// standard, even though no live registry candidate was found to exercise
// it against this phase.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractCareerPageJobPostings } from "../../src/lib/ingestion/extractCareerPageJobPostings.ts";
import { validateRawProviderJob } from "../../src/lib/ingestion/rawProviderJob.ts";

function pageWithJsonLd(jsonLd) {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body>Careers</body></html>`;
}

const singlePosting = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Software Engineer",
  description: "<p>Build <b>things</b>.</p>",
  datePosted: "2026-09-01",
  employmentType: "FULL_TIME",
  identifier: { "@type": "PropertyValue", name: "Fixture Co", value: "job-1234" },
  url: "https://example.test/careers/job-1234",
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Beirut", addressCountry: "LB" } },
};

describe("extractCareerPageJobPostings", () => {
  test("extracts a single JobPosting block", () => {
    const jobs = extractCareerPageJobPostings(pageWithJsonLd(singlePosting));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "job-1234");
    assert.equal(jobs[0].title, "Software Engineer");
    assert.equal(jobs[0].description, "Build things .");
    assert.equal(jobs[0].rawLocation, "Beirut, LB");
    assert.equal(jobs[0].employmentType, "full-time");
    assert.equal(jobs[0].applicationUrl, "https://example.test/careers/job-1234");
  });

  test("passes rawProviderJob validation end-to-end (this is a company-specific extraction, like Tier A)", () => {
    const jobs = extractCareerPageJobPostings(pageWithJsonLd(singlePosting));
    assert.deepEqual(validateRawProviderJob(jobs[0], "career_page"), { valid: true });
  });

  test("extracts multiple JobPosting blocks from one page (an array container)", () => {
    const html = pageWithJsonLd([singlePosting, { ...singlePosting, identifier: { value: "job-5678" }, title: "Data Analyst" }]);
    const jobs = extractCareerPageJobPostings(html);
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((j) => j.externalId).sort(), ["job-1234", "job-5678"]);
  });

  test("extracts JobPosting entries nested inside an @graph wrapper (a common real-world JSON-LD pattern)", () => {
    const html = pageWithJsonLd({ "@context": "https://schema.org", "@graph": [singlePosting] });
    const jobs = extractCareerPageJobPostings(html);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "job-1234");
  });

  test("falls back to the posting's own url as externalId when no identifier block is present", () => {
    const withoutIdentifier = { ...singlePosting };
    delete withoutIdentifier.identifier;
    const jobs = extractCareerPageJobPostings(pageWithJsonLd(withoutIdentifier));
    assert.equal(jobs[0].externalId, "https://example.test/careers/job-1234");
  });

  test("a page with no JSON-LD at all returns an empty array, honestly — never a guess", () => {
    const jobs = extractCareerPageJobPostings("<html><body>No structured data here.</body></html>");
    assert.deepEqual(jobs, []);
  });

  test("a page with malformed JSON-LD is skipped, not fatal, and other valid blocks on the same page still extract", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ this is not valid json </script>
      <script type="application/ld+json">${JSON.stringify(singlePosting)}</script>
    </head><body></body></html>`;
    const jobs = extractCareerPageJobPostings(html);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "job-1234");
  });

  test("a JSON-LD block that is not a JobPosting (e.g. Organization schema) is ignored", () => {
    const html = pageWithJsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Fixture Co" });
    assert.deepEqual(extractCareerPageJobPostings(html), []);
  });

  test("jobLocationType TELECOMMUTE maps to providerWorkArrangement 'remote'", () => {
    const jobs = extractCareerPageJobPostings(pageWithJsonLd({ ...singlePosting, jobLocationType: "TELECOMMUTE" }));
    assert.equal(jobs[0].providerWorkArrangement, "remote");
  });

  test("empty/non-string input never throws", () => {
    assert.deepEqual(extractCareerPageJobPostings(""), []);
    assert.deepEqual(extractCareerPageJobPostings(null), []);
    assert.deepEqual(extractCareerPageJobPostings(undefined), []);
  });
});
