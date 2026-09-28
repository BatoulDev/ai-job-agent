// Unit tests for src/lib/ingestion/providers/* (Phase 04 provider adapters).
// Pure field-mapping logic, no network — fixtures shaped exactly like the
// real Greenhouse/Lever/Workable API responses documented (and
// live-verified) in docs/job-ingestion-pilot.md §2/§5.
//
// Run: node --test tests/unit/ingestion-providers.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapGreenhouseJob } from "../../src/lib/ingestion/providers/greenhouse.ts";
import { mapLeverJob } from "../../src/lib/ingestion/providers/lever.ts";
import { mapWorkableJob } from "../../src/lib/ingestion/providers/workable.ts";
import { mapAshbyJob } from "../../src/lib/ingestion/providers/ashby.ts";
import { mapOracleHcmJob } from "../../src/lib/ingestion/providers/oracle-hcm.ts";
import { mapWorkdayJob } from "../../src/lib/ingestion/providers/workday.ts";
import { mapRemoteOkJob } from "../../src/lib/ingestion/providers/remoteok.ts";
import { mapJobicyJob } from "../../src/lib/ingestion/providers/jobicy.ts";
import { mapArbeitnowJob } from "../../src/lib/ingestion/providers/arbeitnow.ts";
import { mapJSearchJob } from "../../src/lib/ingestion/providers/jsearch.ts";
import { mapAdzunaJob } from "../../src/lib/ingestion/providers/adzuna.ts";
import { mapBaytJob } from "../../src/lib/ingestion/providers/bayt.ts";
import { mapGulfTalentJob } from "../../src/lib/ingestion/providers/gulftalent.ts";
import { getProviderAdapter } from "../../src/lib/ingestion/providers/index.ts";
import { validateRawProviderJob } from "../../src/lib/ingestion/rawProviderJob.ts";
import { validateMultiCompanyProviderJob } from "../../src/lib/ingestion/multiCompanyProviderJob.ts";

describe("mapGreenhouseJob", () => {
  const raw = {
    id: 6789012,
    title: "Backend Engineer",
    absolute_url: "https://boards.greenhouse.io/scaleai/jobs/6789012",
    content: "<p>Build <b>things</b>.&nbsp;Join us!</p>",
    location: { name: "Remote - US" },
    first_published: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
  };

  test("maps required fields and strips HTML from the description", () => {
    const job = mapGreenhouseJob(raw);
    assert.equal(job.externalId, "6789012");
    assert.equal(job.title, "Backend Engineer");
    assert.equal(job.description, "Build things . Join us!");
    assert.equal(job.applicationUrl, "https://boards.greenhouse.io/scaleai/jobs/6789012");
  });

  test("detects a remote work-arrangement hint from the location name", () => {
    const job = mapGreenhouseJob(raw);
    assert.equal(job.providerWorkArrangement, "remote");
    assert.equal(job.rawLocation, "Remote - US");
  });

  test("a non-remote location produces no work-arrangement hint", () => {
    const job = mapGreenhouseJob({ ...raw, location: { name: "Doha, Qatar" } });
    assert.equal(job.providerWorkArrangement, null);
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapGreenhouseJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "greenhouse"), { valid: true });
  });

  test("a job missing an id maps to an empty externalId, which validation then rejects", () => {
    const job = mapGreenhouseJob({ ...raw, id: undefined });
    assert.equal(job.externalId, "");
    assert.deepEqual(validateRawProviderJob(job, "greenhouse"), { valid: false, reason: "missing_external_id" });
  });
});

describe("mapLeverJob", () => {
  const raw = {
    id: "a1b2c3d4-0000-0000-0000-000000000000",
    text: "Product Designer",
    hostedUrl: "https://jobs.lever.co/wahed/a1b2c3d4",
    descriptionPlain: "Design delightful product experiences.",
    categories: { location: "Beirut, Lebanon", commitment: "Full-time", workplaceType: "hybrid" },
    createdAt: 1735689600000,
  };

  test("maps required fields", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.externalId, raw.id);
    assert.equal(job.title, "Product Designer");
    assert.equal(job.description, "Design delightful product experiences.");
    assert.equal(job.applicationUrl, raw.hostedUrl);
    assert.equal(job.rawLocation, "Beirut, Lebanon");
  });

  test("maps categories.workplaceType and commitment through the shared vocab maps", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.providerWorkArrangement, "hybrid");
    assert.equal(job.employmentType, "full-time");
  });

  test("prefers applyUrl over hostedUrl when both are present", () => {
    const job = mapLeverJob({ ...raw, applyUrl: "https://jobs.lever.co/wahed/a1b2c3d4/apply" });
    assert.equal(job.applicationUrl, "https://jobs.lever.co/wahed/a1b2c3d4/apply");
  });

  test("converts createdAt epoch-ms to an ISO publishedAt", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.publishedAt, new Date(raw.createdAt).toISOString());
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapLeverJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "lever"), { valid: true });
  });
});

describe("mapWorkableJob", () => {
  const raw = {
    shortcode: "ABCDE123",
    title: "Sales Associate",
    application_url: "https://apply.workable.com/salla/j/ABCDE123",
    description: "<div>Sell <em>great</em> products.</div>",
    employment_type: "Full-time",
    city: "Riyadh",
    country: "Saudi Arabia",
    telecommuting: false,
    published_on: "2026-08-10",
  };

  test("maps required fields and strips HTML", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.externalId, "ABCDE123");
    assert.equal(job.title, "Sales Associate");
    assert.equal(job.description, "Sell great products.");
    assert.equal(job.applicationUrl, raw.application_url);
  });

  test("joins city and country into rawLocation", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.rawLocation, "Riyadh, Saudi Arabia");
  });

  test("telecommuting:true maps to a remote work-arrangement hint", () => {
    const job = mapWorkableJob({ ...raw, telecommuting: true });
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("maps employment_type through the shared vocab map", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.employmentType, "full-time");
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapWorkableJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "workable"), { valid: true });
  });
});

describe("getProviderAdapter — registry", () => {
  test("returns an adapter for each Tier-A ATS type", () => {
    assert.equal(typeof getProviderAdapter("greenhouse"), "function");
    assert.equal(typeof getProviderAdapter("lever"), "function");
    assert.equal(typeof getProviderAdapter("workable"), "function");
    assert.equal(typeof getProviderAdapter("ashby"), "function");
    assert.equal(typeof getProviderAdapter("oracle_hcm"), "function");
    assert.equal(typeof getProviderAdapter("workday"), "function");
  });

  test("returns an adapter for each Tier-D/C multi-company feed type (Phase 13)", () => {
    assert.equal(typeof getProviderAdapter("remoteok"), "function");
    assert.equal(typeof getProviderAdapter("jobicy"), "function");
    assert.equal(typeof getProviderAdapter("arbeitnow"), "function");
    assert.equal(typeof getProviderAdapter("jsearch"), "function");
    assert.equal(typeof getProviderAdapter("adzuna"), "function");
    assert.equal(typeof getProviderAdapter("bayt"), "function");
    assert.equal(typeof getProviderAdapter("gulftalent"), "function");
  });

  test("career_page has an identity adapter (Phase 14 fix — its jobs arrive pre-extracted from extract-career-page-jobs, no further mapping needed)", () => {
    assert.equal(typeof getProviderAdapter("career_page"), "function");
    const raw = { externalId: "x", title: "t", description: "d", applicationUrl: "https://example.test" };
    assert.deepEqual(getProviderAdapter("career_page")(raw), raw);
  });

  test("returns null for a source type with no automated adapter", () => {
    assert.equal(getProviderAdapter("admin_manual"), null);
    assert.equal(getProviderAdapter("linkedin"), null);
  });
});

describe("mapAshbyJob", () => {
  // Real shape confirmed live this phase: GET
  // https://api.ashbyhq.com/posting-api/job-board/the-studio (a real
  // registry row, sr-qa-the-utopia-studio).
  const raw = {
    id: "8011f5d3-1279-4206-92b3-5a4c01a98c89",
    title: "Founding Product Engineer — Venture Platform & Infrastructure",
    location: "Doha",
    employmentType: "FullTime",
    workplaceType: "OnSite",
    publishedAt: "2025-11-12T17:18:08.003+00:00",
    jobUrl: "https://jobs.ashbyhq.com/the-studio/8011f5d3-1279-4206-92b3-5a4c01a98c89",
    applyUrl: "https://jobs.ashbyhq.com/the-studio/8011f5d3-1279-4206-92b3-5a4c01a98c89/application",
    descriptionHtml: "<h1>About The Studio</h1><p>Some real description.</p>",
  };

  test("maps required fields, prefers applyUrl over jobUrl, and strips HTML", () => {
    const job = mapAshbyJob(raw);
    assert.equal(job.externalId, "8011f5d3-1279-4206-92b3-5a4c01a98c89");
    assert.equal(job.title, "Founding Product Engineer — Venture Platform & Infrastructure");
    assert.equal(job.applicationUrl, "https://jobs.ashbyhq.com/the-studio/8011f5d3-1279-4206-92b3-5a4c01a98c89/application");
    assert.equal(job.sourceListingUrl, "https://jobs.ashbyhq.com/the-studio/8011f5d3-1279-4206-92b3-5a4c01a98c89");
    assert.match(job.description, /Some real description/);
  });

  test("maps workplaceType/employmentType to this project's enums", () => {
    const job = mapAshbyJob(raw);
    assert.equal(job.providerWorkArrangement, "onsite");
    assert.equal(job.employmentType, "full-time");
  });

  test("a remote Ashby posting maps to providerWorkArrangement 'remote'", () => {
    const job = mapAshbyJob({ ...raw, workplaceType: "Remote" });
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapAshbyJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "ashby"), { valid: true });
  });
});

describe("mapOracleHcmJob", () => {
  // Real shape confirmed live this phase: GET https://fa-exxn-saasfaprod1
  // .fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/
  // recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_2&expand=
  // requisitionList returned this exact field set for a real AUBMC posting
  // (docs/LEBANON_GULF_SOURCE_RESEARCH.md §3). candidateSiteUrl is stamped
  // onto each raw item by the n8n fetch step (Oracle's own REST response
  // carries no candidate-facing URL — see the adapter's own header comment).
  const raw = {
    Id: "175",
    Title: "Diabetes Educator",
    ShortDescriptionStr: "The Nursing Administration has an opening for the position of Diabetes Educator in grade 11.",
    PostedDate: "2026-09-14",
    PrimaryLocation: "Lebanon",
    PrimaryLocationCountry: "LB",
    WorkplaceType: "",
    WorkplaceTypeCode: null,
    ContractType: null,
    candidateSiteUrl: "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2",
  };

  test("maps required fields and builds the real candidate-facing apply URL", () => {
    const job = mapOracleHcmJob(raw);
    assert.equal(job.externalId, "175");
    assert.equal(job.title, "Diabetes Educator");
    assert.match(job.description, /Diabetes Educator/);
    assert.equal(job.rawLocation, "Lebanon");
    assert.equal(job.publishedAt, "2026-09-14");
    assert.equal(job.applicationUrl, "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/job/175");
    assert.equal(job.sourceListingUrl, job.applicationUrl);
  });

  test("a job with no candidateSiteUrl stamped maps to a null applicationUrl (validation then rejects it, never invents a link)", () => {
    const job = mapOracleHcmJob({ ...raw, candidateSiteUrl: undefined });
    assert.equal(job.applicationUrl, null);
    assert.deepEqual(validateRawProviderJob(job, "oracle_hcm"), { valid: false, reason: "missing_application_target" });
  });

  test("maps WorkplaceTypeCode to this project's work-arrangement enum when present (documented Oracle vocabulary, not observed live — the sampled tenant's jobs were all on-site/null)", () => {
    const job = mapOracleHcmJob({ ...raw, WorkplaceTypeCode: "REMOTE" });
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("empty/null WorkplaceType produces no work-arrangement hint, never a guess", () => {
    const job = mapOracleHcmJob(raw);
    assert.equal(job.providerWorkArrangement, null);
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapOracleHcmJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "oracle_hcm"), { valid: true });
  });
});

describe("mapRemoteOkJob", () => {
  // Real shape confirmed live this phase: GET https://remoteok.com/api
  // (second array element — the first is always a legend/metadata object,
  // skipped by the caller before this per-item adapter runs).
  const raw = {
    id: "1137431",
    company: "Mercier Consultancy Group",
    position: "Danish Speaking Solutions Consultant Work Sofia Bulgaria",
    description: "<p>Danish Speaking Solutions Consultant</p><p>About Mercier...</p>",
    location: "",
    apply_url: "https://remoteOK.com/remote-jobs/remote-danish-speaking-solutions-consultant-work-sofia-bulgaria-mercier-consultancy-group-1137431",
    url: "https://remoteOK.com/remote-jobs/remote-danish-speaking-solutions-consultant-work-sofia-bulgaria-mercier-consultancy-group-1137431",
    date: "2026-09-24T16:00:06+00:00",
  };

  test("maps required fields, using RemoteOK's own listing URL as the application target", () => {
    const job = mapRemoteOkJob(raw);
    assert.equal(job.externalId, "1137431");
    assert.equal(job.title, "Danish Speaking Solutions Consultant Work Sofia Bulgaria");
    assert.equal(job.companyName, "Mercier Consultancy Group");
    assert.equal(job.applicationUrl, raw.apply_url);
    assert.equal(job.sourceListingUrl, raw.url);
  });

  test("an empty location string maps to null rawLocation, not an empty string", () => {
    const job = mapRemoteOkJob(raw);
    assert.equal(job.rawLocation, null);
  });

  test("always marks providerWorkArrangement remote — RemoteOK lists remote jobs exclusively", () => {
    const job = mapRemoteOkJob(raw);
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("passes validateMultiCompanyProviderJob end-to-end (requires companyName, unlike Tier-A)", () => {
    const job = mapRemoteOkJob(raw);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "remoteok"), { valid: true });
  });

  test("a job missing a company name is rejected by the multi-company validator", () => {
    const job = mapRemoteOkJob({ ...raw, company: undefined });
    assert.deepEqual(validateMultiCompanyProviderJob(job, "remoteok"), { valid: false, reason: "missing_company_name" });
  });
});

describe("mapJobicyJob", () => {
  // Real shape confirmed live this phase: GET
  // https://jobicy.com/api/v2/remote-jobs?count=N.
  const raw = {
    id: 151756,
    url: "https://jobicy.com/jobs/151756-engineering-manager-notifications",
    jobTitle: "Engineering Manager, Notifications",
    companyName: "Discord",
    jobGeo: "USA",
    jobLevel: "Senior",
    jobType: ["Full-Time"],
    jobDescription: "<p>Discord has a highly engaged community...</p>",
    pubDate: "2026-09-27T07:45:07+00:00",
  };

  test("maps required fields", () => {
    const job = mapJobicyJob(raw);
    assert.equal(job.externalId, "151756");
    assert.equal(job.title, "Engineering Manager, Notifications");
    assert.equal(job.companyName, "Discord");
    assert.equal(job.applicationUrl, raw.url);
  });

  test("maps jobType/jobLevel to this project's enums", () => {
    const job = mapJobicyJob(raw);
    assert.equal(job.employmentType, "full-time");
    assert.equal(job.seniority, "senior");
  });

  test("an unmapped jobLevel (e.g. 'Director', 'Any' — no equivalent in our enum) stays null rather than guess", () => {
    const job = mapJobicyJob({ ...raw, jobLevel: "Director" });
    assert.equal(job.seniority, null);
    const job2 = mapJobicyJob({ ...raw, jobLevel: "Any" });
    assert.equal(job2.seniority, null);
  });

  test("passes validateMultiCompanyProviderJob end-to-end", () => {
    const job = mapJobicyJob(raw);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "jobicy"), { valid: true });
  });
});

describe("mapArbeitnowJob", () => {
  // Real shape confirmed live this phase: GET
  // https://www.arbeitnow.com/api/job-board-api.
  const raw = {
    slug: "werkstudent-video-editor-munster-73473",
    company_name: "paselo GmbH",
    title: "(Werkstudent) Video Editor (m/w/d)",
    description: "<p>paselo ist ein junges Unternehmen...</p>",
    remote: true,
    url: "https://www.arbeitnow.com/jobs/companies/paselo-gmbh/werkstudent-video-editor-munster-73473",
    job_types: ["Working student"],
    location: "Münster",
    created_at: 1790512259,
  };

  test("maps required fields, using slug as the external id (no separate numeric id in the real API)", () => {
    const job = mapArbeitnowJob(raw);
    assert.equal(job.externalId, "werkstudent-video-editor-munster-73473");
    assert.equal(job.companyName, "paselo GmbH");
    assert.equal(job.applicationUrl, raw.url);
  });

  test("remote:true maps to providerWorkArrangement 'remote'; remote:false maps to null (no onsite override)", () => {
    const remoteJob = mapArbeitnowJob(raw);
    assert.equal(remoteJob.providerWorkArrangement, "remote");
    const onsiteJob = mapArbeitnowJob({ ...raw, remote: false });
    assert.equal(onsiteJob.providerWorkArrangement, null);
  });

  test("converts the unix-epoch-seconds created_at into an ISO publishedAt", () => {
    const job = mapArbeitnowJob(raw);
    assert.equal(job.publishedAt, new Date(1790512259 * 1000).toISOString());
  });

  test("passes validateMultiCompanyProviderJob end-to-end", () => {
    const job = mapArbeitnowJob(raw);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "arbeitnow"), { valid: true });
  });
});

describe("mapJSearchJob / mapAdzunaJob — BLOCKED_ON_CREDENTIAL, documented-schema fixtures only (never live-verified)", () => {
  test("mapJSearchJob maps the documented RapidAPI JSearch response shape", () => {
    const job = mapJSearchJob({
      job_id: "abc123",
      job_title: "Backend Engineer",
      employer_name: "Fixture Co",
      job_description: "Build things.",
      job_apply_link: "https://example.test/apply",
      job_city: "Dubai",
      job_country: "AE",
      job_employment_type: "FULLTIME",
      job_is_remote: false,
      job_posted_at_datetime_utc: "2026-09-01T00:00:00Z",
    });
    assert.equal(job.externalId, "abc123");
    assert.equal(job.companyName, "Fixture Co");
    assert.equal(job.rawLocation, "Dubai, AE");
    assert.equal(job.employmentType, "full-time");
    assert.deepEqual(validateMultiCompanyProviderJob(job, "jsearch"), { valid: true });
  });

  test("mapAdzunaJob maps the documented Adzuna /search response shape", () => {
    const job = mapAdzunaJob({
      id: 999,
      title: "Data Analyst",
      description: "Analyze data.",
      company: { display_name: "Fixture Adzuna Co" },
      location: { display_name: "Doha, Qatar" },
      redirect_url: "https://example.test/adzuna-apply",
      created: "2026-09-01T00:00:00Z",
      contract_type: "full_time",
    });
    assert.equal(job.externalId, "999");
    assert.equal(job.companyName, "Fixture Adzuna Co");
    assert.equal(job.rawLocation, "Doha, Qatar");
    assert.equal(job.employmentType, "full-time");
    assert.deepEqual(validateMultiCompanyProviderJob(job, "adzuna"), { valid: true });
  });
});

describe("mapWorkdayJob — mapping logic only, NOT wired into the ingestion workflow this phase (docs/LEBANON_GULF_SOURCE_RESEARCH.md §3)", () => {
  // Real shape confirmed live this phase: POST https://murex.wd3
  // .myworkdayjobs.com/wday/cxs/murex/MurexCareerPage1/jobs returned this
  // exact field set for a real Murex posting.
  const raw = {
    title: "Intership 2027 - UI Software Engineer",
    externalPath: "/job/Paris/Intership-2027---Design-System-Sample-Assembly-Application_JR103210",
    locationsText: "Paris",
    postedOn: "Posted 2 Days Ago",
    bulletFields: ["JR103210", "Intern"],
    tenantSiteBaseUrl: "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1",
  };

  test("maps the real requisition ID, title, location, and builds the real confirmed public apply URL", () => {
    const job = mapWorkdayJob(raw);
    assert.equal(job.externalId, "JR103210");
    assert.equal(job.title, "Intership 2027 - UI Software Engineer");
    assert.equal(job.rawLocation, "Paris");
    assert.equal(job.applicationUrl, "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1/job/Paris/Intership-2027---Design-System-Sample-Assembly-Application_JR103210");
    assert.equal(job.sourceListingUrl, job.applicationUrl);
  });

  test("description is always empty — the real list endpoint carries no description field, and this must never be fabricated", () => {
    const job = mapWorkdayJob(raw);
    assert.equal(job.description, "");
  });

  test("real-shaped Workday jobs are honestly rejected by validation until a per-job detail fetch supplies a description — never silently accepted with an empty one", () => {
    const job = mapWorkdayJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "workday"), { valid: false, reason: "missing_description" });
  });

  test("a job with a description supplied (from a future per-job detail fetch) passes validation", () => {
    const job = mapWorkdayJob({ ...raw, description: "<p>Real job description text.</p>" });
    assert.match(job.description, /Real job description text/);
    assert.deepEqual(validateRawProviderJob(job, "workday"), { valid: true });
  });

  test("falls back to externalPath as the external ID when bulletFields is absent, never invents one", () => {
    const job = mapWorkdayJob({ ...raw, bulletFields: undefined });
    assert.equal(job.externalId, raw.externalPath);
  });

  test("a job with no tenantSiteBaseUrl stamped maps to a null applicationUrl, never a guessed one", () => {
    const job = mapWorkdayJob({ ...raw, tenantSiteBaseUrl: undefined });
    assert.equal(job.applicationUrl, null);
  });
});

describe("mapBaytJob / mapGulfTalentJob — BLOCKED_ON_AUTHORIZATION, documented Apify actor schema fixtures only (never live-verified, docs/LEBANON_GULF_SOURCE_RESEARCH.md §5)", () => {
  test("mapBaytJob maps the blackfalcondata/bayt-scraper documented output schema", () => {
    const job = mapBaytJob({
      jobId: "bayt-12345",
      title: "Accountant",
      company: "Fixture Bayt Co",
      location: "Beirut, Lebanon",
      city: "Beirut",
      country: "Lebanon",
      employmentType: "Full Time",
      description: "Handle accounts.",
      isRemote: false,
      url: "https://www.bayt.com/en/lebanon/jobs/fixture-12345/",
      applyUrl: "https://www.bayt.com/en/lebanon/jobs/fixture-12345/apply/",
      postedDate: "2026-09-01",
    });
    assert.equal(job.externalId, "bayt-12345");
    assert.equal(job.companyName, "Fixture Bayt Co");
    assert.equal(job.rawLocation, "Beirut, Lebanon");
    assert.equal(job.applicationUrl, "https://www.bayt.com/en/lebanon/jobs/fixture-12345/apply/");
    assert.equal(job.employmentType, "full-time");
    assert.deepEqual(validateMultiCompanyProviderJob(job, "bayt"), { valid: true });
  });

  test("mapBaytJob prefers applyUrl over url, and falls back to url when applyUrl is absent", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d", url: "https://www.bayt.com/x" });
    assert.equal(job.applicationUrl, "https://www.bayt.com/x");
  });

  test("mapBaytJob isRemote:true maps to providerWorkArrangement remote", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d", url: "https://www.bayt.com/x", isRemote: true });
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("mapGulfTalentJob maps the blackfalcondata/gulftalent-scraper documented output schema", () => {
    const job = mapGulfTalentJob({
      jobId: "gt-6789",
      jobKey: "gt-key-6789",
      title: "HR Manager",
      company: "Fixture GulfTalent Co",
      location: "Dubai, UAE",
      employmentType: "Full Time",
      description: "Manage HR.",
      applyUrl: "https://www.gulftalent.com/uae/jobs/fixture-6789",
      postedAt: "2026-09-01",
    });
    assert.equal(job.externalId, "gt-6789");
    assert.equal(job.companyName, "Fixture GulfTalent Co");
    assert.equal(job.rawLocation, "Dubai, UAE");
    assert.equal(job.applicationUrl, "https://www.gulftalent.com/uae/jobs/fixture-6789");
    assert.equal(job.employmentType, "full-time");
    assert.deepEqual(validateMultiCompanyProviderJob(job, "gulftalent"), { valid: true });
  });

  test("mapGulfTalentJob falls back to jobKey when jobId is absent, never invents a third identifier", () => {
    const job = mapGulfTalentJob({ jobKey: "gt-key-only", title: "t", company: "c", description: "d", applyUrl: "https://www.gulftalent.com/x" });
    assert.equal(job.externalId, "gt-key-only");
  });

  // Phase 19: read-only prep for the next phase's live benchmark — closes
  // real gaps in edge-case coverage found during this phase's re-audit of
  // the Phase 16 adapters (missing location/work-arrangement/apply-URL,
  // malformed payloads — Task F of docs/BAYT_GULFTALENT_LIVE_PREP.md).

  test("mapBaytJob: missing location (no location/city/country at all) maps to null rawLocation, never guessed", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d", url: "https://www.bayt.com/x" });
    assert.equal(job.rawLocation, null);
  });

  test("mapBaytJob: city+country present but no combined location field still builds a joined rawLocation", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d", url: "https://www.bayt.com/x", city: "Doha", country: "Qatar" });
    assert.equal(job.rawLocation, "Doha, Qatar");
  });

  test("mapBaytJob: isRemote absent (not just false) maps to null providerWorkArrangement, never defaults to onsite", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d", url: "https://www.bayt.com/x" });
    assert.equal(job.providerWorkArrangement, null);
  });

  test("mapBaytJob: neither applyUrl nor url present maps to a null applicationUrl, which validation then correctly rejects as missing_application_target — never an invented apply link", () => {
    const job = mapBaytJob({ jobId: "x", title: "t", company: "c", description: "d" });
    assert.equal(job.applicationUrl, null);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "bayt"), { valid: false, reason: "missing_application_target" });
  });

  test("mapBaytJob: a completely empty raw object never throws — produces an all-empty shape that validation then correctly rejects (missing_company_name, checked first by the multi-company validator)", () => {
    const job = mapBaytJob({});
    assert.equal(job.externalId, "");
    assert.equal(job.title, null);
    assert.equal(job.rawLocation, null);
    assert.equal(job.applicationUrl, null);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "bayt"), { valid: false, reason: "missing_company_name" });
  });

  test("mapGulfTalentJob: missing location maps to null rawLocation, never guessed", () => {
    const job = mapGulfTalentJob({ jobId: "x", title: "t", company: "c", description: "d", applyUrl: "https://www.gulftalent.com/x" });
    assert.equal(job.rawLocation, null);
  });

  test("mapGulfTalentJob: providerWorkArrangement is always null — the actor's documented schema (docs/LEBANON_GULF_SOURCE_RESEARCH.md §5) has no work-arrangement/remote field at all, so this must never be inferred from title/description text", () => {
    const job = mapGulfTalentJob({ jobId: "x", title: "Remote Software Engineer", company: "c", description: "d", applyUrl: "https://www.gulftalent.com/x" });
    assert.equal(job.providerWorkArrangement, null);
  });

  test("mapGulfTalentJob: no applyUrl present maps to a null applicationUrl, which validation then correctly rejects — never an invented apply link", () => {
    const job = mapGulfTalentJob({ jobId: "x", title: "t", company: "c", description: "d" });
    assert.equal(job.applicationUrl, null);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "gulftalent"), { valid: false, reason: "missing_application_target" });
  });

  test("mapGulfTalentJob: a completely empty raw object never throws — produces an all-empty shape that validation then correctly rejects (missing_company_name, checked first by the multi-company validator)", () => {
    const job = mapGulfTalentJob({});
    assert.equal(job.externalId, "");
    assert.equal(job.title, null);
    assert.deepEqual(validateMultiCompanyProviderJob(job, "gulftalent"), { valid: false, reason: "missing_company_name" });
  });

  test("mapBaytJob / mapGulfTalentJob: a raw job missing companyName is rejected by the multi-company validator specifically (missing_company_name), not the generic Tier-A rule — proves both adapters flow through the correct validator", () => {
    const baytJob = mapBaytJob({ jobId: "x", title: "t", description: "d", url: "https://www.bayt.com/x" });
    assert.equal(baytJob.companyName, null);
    assert.deepEqual(validateMultiCompanyProviderJob(baytJob, "bayt"), { valid: false, reason: "missing_company_name" });

    const gtJob = mapGulfTalentJob({ jobId: "x", title: "t", description: "d", applyUrl: "https://www.gulftalent.com/x" });
    assert.equal(gtJob.companyName, null);
    assert.deepEqual(validateMultiCompanyProviderJob(gtJob, "gulftalent"), { valid: false, reason: "missing_company_name" });
  });
});
