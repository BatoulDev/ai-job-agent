// Unit tests for classifyWorkArrangementFromText.ts — precision-first,
// never-guess work-arrangement extraction from unstructured job-posting
// text (built for LinkedIn descriptions, where no structured provider
// field exists — see docs/LINKEDIN_JOB_DISCOVERY_RESEARCH.md). Cases
// mirror real text observed in the real Bebity Lebanon pilots.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkArrangementFromText } from "../../src/lib/ingestion/classifyWorkArrangementFromText.ts";

describe("classifyWorkArrangementFromText — remote true positives", () => {
  test("fully remote", () => {
    const r = classifyWorkArrangementFromText({ description: "This is a fully remote role based anywhere." });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.confidence, "high");
    assert.ok(r.evidence.includes("fully remote"));
  });

  test("100% remote", () => {
    const r = classifyWorkArrangementFromText({ description: "Excellent compensation. 100% remote work (from anywhere)." });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.confidence, "high");
  });

  test("work from home", () => {
    const r = classifyWorkArrangementFromText({ description: "Hardware and software setup for you to work from home." });
    assert.equal(r.workArrangement, "remote");
  });

  test("remote position", () => {
    const r = classifyWorkArrangementFromText({ description: "We are looking for a candidate for this remote position." });
    assert.equal(r.workArrangement, "remote");
  });

  test("real Bebity text: Remote Work-at-Home position overview", () => {
    const r = classifyWorkArrangementFromText({ description: "Remote Work-at-Home POSITION OVERVIEW MCI is one of the fastest-growing companies." });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.confidence, "high");
  });

  test("real Bebity text (false-negative fix): remote-first work environment", () => {
    const r = classifyWorkArrangementFromText({ description: "An international, remote-first work environment with colleagues from around the globe." });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.confidence, "high");
  });

  test("real Bebity text (false-negative fix): 'Located Remotely? Y' ATS field echo", () => {
    const r = classifyWorkArrangementFromText({ description: "Schedule Full Time Located Remotely? Y Position Type Non-Management" });
    assert.equal(r.workArrangement, "remote");
  });
});

describe("classifyWorkArrangementFromText — hybrid true positives", () => {
  test("hybrid work model", () => {
    const r = classifyWorkArrangementFromText({ description: "We follow a hybrid work model for this team." });
    assert.equal(r.workArrangement, "hybrid");
    assert.equal(r.confidence, "high");
  });

  test("3 days office / 2 remote", () => {
    const r = classifyWorkArrangementFromText({ description: "This role requires 3 days in the office and 2 days remote each week." });
    assert.equal(r.workArrangement, "hybrid");
  });

  test("real Bebity text: 2-3 days on-site / 2-3 remote", () => {
    const r = classifyWorkArrangementFromText({
      description: "The details * Beirut — hybrid, 2-3 days on-site / 2-3 remote * 13:30-23:30 Beirut time.",
    });
    assert.equal(r.workArrangement, "hybrid");
    assert.equal(r.confidence, "high");
  });

  test("hybrid working arrangement (benefits bullet)", () => {
    const r = classifyWorkArrangementFromText({ description: "Comprehensive private medical insurance. Hybrid working arrangement. Ongoing training." });
    assert.equal(r.workArrangement, "hybrid");
  });

  test("real Bebity text: hybrid approach, four days in office", () => {
    const r = classifyWorkArrangementFromText({
      description: "That's why we've adopted a hybrid approach, with teams in the office around four days a week.",
    });
    assert.equal(r.workArrangement, "hybrid");
  });
});

describe("classifyWorkArrangementFromText — onsite true positives", () => {
  test("fully onsite", () => {
    const r = classifyWorkArrangementFromText({ description: "This is a fully onsite manufacturing role." });
    assert.equal(r.workArrangement, "onsite");
    assert.equal(r.confidence, "high");
  });

  test("onsite position", () => {
    const r = classifyWorkArrangementFromText({ description: "Candidates must be available for this onsite position." });
    assert.equal(r.workArrangement, "onsite");
  });

  test("office-based position", () => {
    const r = classifyWorkArrangementFromText({ description: "This is an office-based position in our Beirut HQ." });
    assert.equal(r.workArrangement, "onsite");
  });

  test("real Bebity text (false-negative fix): 'Located Remotely? N' ATS field echo", () => {
    const r = classifyWorkArrangementFromText({ description: "Schedule Full Time Located Remotely? N Position Type Non-Management Position Summary Prepare breads." });
    assert.equal(r.workArrangement, "onsite");
  });
});

describe("classifyWorkArrangementFromText — false-positive guards (must stay null)", () => {
  test("hybrid cloud infrastructure", () => {
    const r = classifyWorkArrangementFromText({ description: "Experience with hybrid cloud infrastructure and AWS is required." });
    assert.equal(r.workArrangement, null);
  });

  test("remote servers", () => {
    const r = classifyWorkArrangementFromText({ description: "Monitor and maintain remote servers across our data centers." });
    assert.equal(r.workArrangement, null);
  });

  test("remote teams", () => {
    const r = classifyWorkArrangementFromText({ description: "Collaborate with remote teams across multiple time zones." });
    assert.equal(r.workArrangement, null);
  });

  test("onsite client visits", () => {
    const r = classifyWorkArrangementFromText({ description: "Occasional on-site client visits may be required for this account manager role." });
    assert.equal(r.workArrangement, null);
  });

  test("remote access tools", () => {
    const r = classifyWorkArrangementFromText({ description: "Proficient with remote access tools and VPN software." });
    assert.equal(r.workArrangement, null);
  });

  test("generic flexibility language alone", () => {
    const r = classifyWorkArrangementFromText({ description: "We offer flexible work arrangements and a supportive culture." });
    assert.equal(r.workArrangement, null);
  });

  test("real Bebity text: conditional 'for those who would prefer hybrid-working' is an elective perk, not a role-level statement", () => {
    const r = classifyWorkArrangementFromText({
      description: "A growing team and a brand new Beirut office (for those who would prefer hybrid-working)!",
    });
    assert.equal(r.workArrangement, null);
  });

  test("real Bebity text: company-wide onsite+remote staffing boilerplate must not fire alone", () => {
    const r = classifyWorkArrangementFromText({
      description: "Our contact centers are powered by both on-site and remote agents, leveraging advanced technologies.",
    });
    assert.equal(r.workArrangement, null);
  });
});

describe("classifyWorkArrangementFromText — negation", () => {
  test("not a remote position", () => {
    const r = classifyWorkArrangementFromText({ description: "Please note this is not a remote position." });
    assert.equal(r.workArrangement, null);
  });

  test("remote work is not available", () => {
    const r = classifyWorkArrangementFromText({ description: "Remote work is not available for this role at this time." });
    assert.equal(r.workArrangement, null);
  });

  test("real second-batch find: 'This is not a remote position' correctly stays null, not auto-promoted to onsite", () => {
    const r = classifyWorkArrangementFromText({
      description: "Candidate should be willing to work based on American Standard Eastern Time zone. This is not a remote position.",
    });
    assert.equal(r.workArrangement, null);
  });
});

describe("classifyWorkArrangementFromText — conflict handling", () => {
  test("genuinely conflicting unrelated strong signals -> null", () => {
    const r = classifyWorkArrangementFromText({
      description: "This is a remote position. A separate team nearby works in an onsite position for client support.",
    });
    assert.equal(r.workArrangement, null);
  });

  test("mixed unclear arrangement phrase -> null", () => {
    const r = classifyWorkArrangementFromText({ description: "Workplace arrangement varies by project." });
    assert.equal(r.workArrangement, null);
  });

  test("real Bebity text: internally-inconsistent posting (a 'Remote-working arrangement' benefits bullet alongside a separate conditional 'hybrid for those who prefer' line) stays null, never guessed", () => {
    const r = classifyWorkArrangementFromText({
      description:
        "Career growth opportunities and study leave options * Remote-working arrangement * Growing business with a global presence and a brand new Beirut office (for those who would prefer hybrid-working)!",
    });
    assert.equal(r.workArrangement, null);
  });

  test("real second-batch confirmation: the same deliberately-ambiguous template reappears on a second, different real job (DevOps Engineer) at the same employer — verdict stays stable", () => {
    const r = classifyWorkArrangementFromText({
      description:
        "Career growth opportunities and study leave options * Remote-working arrangement * Growing business, a growing Lebanon team and a brand new Beirut office (for those who would prefer hybrid-working)!",
    });
    assert.equal(r.workArrangement, null);
  });

  // Known, documented coverage gap (second-batch false-negative audit):
  // "Remote working in an ambitious, entrepreneurial team" (real text, The
  // Flex / Video Editor posting) is a genuine miss in isolation, but a bare
  // "remote working" pattern is NOT added here — it would also fire on the
  // BigHand posting above's "Remote-working arrangement" bullet, which this
  // module deliberately keeps null due to a real, separate internal
  // conflict (the same posting's conditional hybrid clause). Resolving
  // both correctly needs cross-sentence conflict detection this module
  // does not yet have — adding the pattern now would trade one real
  // false-negative fix for one real false-positive regression, which the
  // precision-first mandate forbids. Documented, not fixed, until a safer
  // generalization is found.
  test("known documented gap: 'Remote working in an ambitious team' stays null (not yet safely generalizable — see comment above)", () => {
    const r = classifyWorkArrangementFromText({
      description: "Help build a video team. Remote working in an ambitious, entrepreneurial team. We value ownership.",
    });
    assert.equal(r.workArrangement, null);
  });
});

describe("classifyWorkArrangementFromText — null cases", () => {
  test("no workplace signal at all", () => {
    const r = classifyWorkArrangementFromText({ description: "We are looking for a detail-oriented accountant with 5 years of experience." });
    assert.equal(r.workArrangement, null);
    assert.equal(r.confidence, null);
    assert.equal(r.evidence, null);
  });

  test("null description", () => {
    const r = classifyWorkArrangementFromText({ description: null });
    assert.equal(r.workArrangement, null);
  });

  test("empty description", () => {
    const r = classifyWorkArrangementFromText({ description: "   " });
    assert.equal(r.workArrangement, null);
  });
});

describe("classifyWorkArrangementFromText — evidence integrity", () => {
  test("evidence is an exact substring of the source description", () => {
    const desc = "This is a fully remote role with great benefits.";
    const r = classifyWorkArrangementFromText({ description: desc });
    assert.ok(desc.includes(r.evidence), "evidence must be an exact fragment of the source text, never invented");
  });
});

describe("classifyWorkArrangementFromText — title signal policy (Phase 14)", () => {
  test("title says Remote, description confirms -> classified via description, not title alone", () => {
    const r = classifyWorkArrangementFromText({
      title: "Remote Call Center Representative",
      description: "This is a remote position working from home.",
    });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.titleOnlySignal, null);
  });

  test("title says Remote but description has no supporting evidence -> not classified, reported separately", () => {
    const r = classifyWorkArrangementFromText({
      title: "Remote Call Center Representative",
      description: "We are looking for a detail-oriented customer service professional.",
    });
    assert.equal(r.workArrangement, null);
    assert.equal(r.titleOnlySignal, "remote");
  });

  test("real second-batch find: trailing '(Remote)' in title is also surfaced as titleOnlySignal when description is only suggestive, not explicit", () => {
    const r = classifyWorkArrangementFromText({
      title: "Flutter Developer (Remote)",
      description: "Detail-oriented and proactive. Comfortable working with a small distributed team.",
    });
    // "distributed team" alone is not explicit role-level evidence — stays null.
    assert.equal(r.workArrangement, null);
    assert.equal(r.titleOnlySignal, "remote");
  });
});
