// DB integration tests for the plan-aware job-preferences foundation
// (feat/plan-aware-job-preferences): Lebanese location flexibility and the
// Pro-only structured international-preferences model added by
// supabase/migrations/20260902090000_add_relocation_market_catalog.sql and
// 20260902090010_plan_aware_job_preferences.sql, plus the Student-to-Pro
// upgrade pricing added by 20260902090020_add_student_to_pro_upgrade_support.sql.
//
// Run: node --test tests/db/international-job-preferences.test.mjs
// (requires a running local Supabase project with all migrations applied)

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

let roleSlug;
let lebanonLocationSlug;
let relocationLocations; // [{slug, name, country_code}, ...]

before(async () => {
  await assertExpectedLocalProject();

  const [roleRes, lebLocRes, relocRes] = await Promise.all([
    adminClient.from("target_roles").select("slug").eq("is_active", true).limit(1),
    adminClient
      .from("locations")
      .select("slug")
      .eq("is_active", true)
      .eq("is_relocation_market", false)
      .limit(1),
    adminClient
      .from("locations")
      .select("slug, name, country_code")
      .eq("is_active", true)
      .eq("is_relocation_market", true)
      .order("sort_order"),
  ]);

  assert.ok(roleRes.data?.length, "need at least 1 active target_roles row");
  assert.ok(lebLocRes.data?.length, "need at least 1 active non-relocation locations row");
  assert.ok(relocRes.data?.length >= 2, "need at least 2 active relocation-market locations rows");

  roleSlug = roleRes.data[0].slug;
  lebanonLocationSlug = lebLocRes.data[0].slug;
  relocationLocations = relocRes.data;
});

async function setPlan(userId, planCode, { status = "active", periodEnd = null } = {}) {
  const { error } = await adminClient
    .from("subscriptions")
    .update({
      plan_code: planCode,
      status,
      provider: planCode === "free" ? "free" : "whish",
      current_period_start: periodEnd ? new Date().toISOString() : null,
      current_period_end: periodEnd,
    })
    .eq("user_id", userId);
  assert.equal(error, null, `failed to set plan: ${error?.message}`);
}

function baseSaveArgs(overrides = {}) {
  return {
    p_work_arrangement: "remote",
    p_job_market_coverage: null,
    p_job_type: "full-time",
    p_experience_level: "junior",
    p_additional_notes: null,
    p_custom_target_roles: [],
    p_custom_locations: [],
    p_target_role_ids: [roleSlug],
    p_location_ids: [],
    p_lebanon_location_scope: "selected_only",
    p_international_search_enabled: false,
    p_willing_to_relocate: null,
    p_relocation_location_ids: null,
    p_work_authorization_status: null,
    p_work_authorization_country_ids: null,
    ...overrides,
  };
}

describe("Lebanon location flexibility (lebanon_location_scope)", () => {
  let user;

  before(async () => {
    user = await createTestUser("lbscope");
  });
  after(async () => {
    await deleteTestUsers([user]);
  });

  test("save is rejected without a valid lebanon_location_scope", async () => {
    const { error } = await user.client.rpc("save_job_preferences", baseSaveArgs({ p_lebanon_location_scope: null }));
    assert.ok(error, "expected rejection");
    assert.match(error.message, /closely/i);
  });

  test("each canonical scope value is accepted", async () => {
    for (const scope of ["selected_only", "selected_and_nearby", "anywhere_in_lebanon"]) {
      const { data, error } = await user.client.rpc(
        "save_job_preferences",
        baseSaveArgs({ p_lebanon_location_scope: scope })
      );
      assert.equal(error, null, `scope ${scope} should be accepted: ${error?.message}`);
      assert.equal(data.lebanon_location_scope, scope);
    }
  });
});

describe("Student security: cannot activate international search", () => {
  let user;

  before(async () => {
    user = await createTestUser("student-intl");
    await setPlan(user.id, "student", { status: "active", periodEnd: new Date(Date.now() + 86400000).toISOString() });
  });
  after(async () => {
    await deleteTestUsers([user]);
  });

  test("save_job_preferences rejects international_search_enabled = true for a Student", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({ p_international_search_enabled: true, p_willing_to_relocate: false })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /Pro plan/i);
  });

  test("a crafted direct table update to job_preferences cannot bypass the RPC gate", async () => {
    // First, a normal (non-international) save so a row exists to update.
    const { error: setupErr } = await user.client.rpc("save_job_preferences", baseSaveArgs());
    assert.equal(setupErr, null, `setup save failed: ${setupErr?.message}`);

    const { error } = await user.client
      .from("job_preferences")
      .update({ international_search_enabled: true })
      .eq("user_id", user.id);
    assert.ok(error, "a direct client update must be rejected by the eligibility trigger");
    assert.match(error.message, /Pro plan/i);

    const { data: row } = await adminClient
      .from("job_preferences")
      .select("international_search_enabled")
      .eq("user_id", user.id)
      .single();
    assert.equal(row.international_search_enabled, false, "the crafted update must never have taken effect");
  });
});

describe("Direct Pro: international preferences", () => {
  let user;

  before(async () => {
    user = await createTestUser("pro-intl");
    await setPlan(user.id, "pro", { status: "active", periodEnd: new Date(Date.now() + 86400000).toISOString() });
  });
  after(async () => {
    await deleteTestUsers([user]);
  });

  test("international_search_enabled = true requires an explicit willing_to_relocate answer", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({ p_international_search_enabled: true, p_willing_to_relocate: null })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /willing to relocate/i);
  });

  test("disabled international search saves cleanly and is a complete state", async () => {
    const { data, error } = await user.client.rpc("save_job_preferences", baseSaveArgs());
    assert.equal(error, null, `save failed: ${error?.message}`);
    assert.equal(data.international_search_enabled, false);

    const { data: readiness, error: readinessErr } = await user.client.rpc("get_onboarding_readiness");
    assert.equal(readinessErr, null);
    assert.equal(readiness.international_search_enabled, false);
    assert.equal(readiness.international_preferences_complete, true, "disabled international search must be a complete state, not incomplete");
  });

  test("remote-only (willing_to_relocate = false) requires no relocation locations or authorization", async () => {
    const { data, error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({ p_international_search_enabled: true, p_willing_to_relocate: false })
    );
    assert.equal(error, null, `save failed: ${error?.message}`);
    assert.equal(data.willing_to_relocate, false);
    assert.equal(data.work_authorization_status, null);

    const { data: readiness } = await user.client.rpc("get_onboarding_readiness");
    assert.equal(readiness.international_search_enabled, true);
    assert.equal(readiness.international_preferences_complete, true, "remote-only must be complete with no relocation fields");
  });

  test("willing_to_relocate = true requires at least one relocation location", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [],
      })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /relocate to/i);
  });

  test("willing_to_relocate = true requires a work authorization answer", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [relocationLocations[0].slug],
        p_work_authorization_status: null,
      })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /authorization question/i);
  });

  test("already_authorized requires at least one authorized country", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [relocationLocations[0].slug],
        p_work_authorization_status: "already_authorized",
        p_work_authorization_country_ids: [],
      })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /at least one country/i);
  });

  test("an authorized country must match a selected relocation location's country", async () => {
    // Pick a country NOT among the selected relocation location's country.
    const selected = relocationLocations[0];
    const unrelated = relocationLocations.find((l) => l.country_code !== selected.country_code);
    if (!unrelated) return; // only one country configured locally; skip
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [selected.slug],
        p_work_authorization_status: "already_authorized",
        p_work_authorization_country_ids: [unrelated.country_code],
      })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /must match one of your selected relocation locations/i);
  });

  test("a full valid relocation configuration saves successfully", async () => {
    const selected = relocationLocations[0];
    const { data, error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [selected.slug],
        p_work_authorization_status: "already_authorized",
        p_work_authorization_country_ids: [selected.country_code],
      })
    );
    assert.equal(error, null, `save failed: ${error?.message}`);

    const { data: relocRows } = await adminClient
      .from("job_preference_relocation_locations")
      .select("location_id")
      .eq("job_preference_id", data.id);
    assert.deepEqual(relocRows.map((r) => r.location_id), [selected.slug]);

    const { data: authRows } = await adminClient
      .from("job_preference_authorized_countries")
      .select("country_code")
      .eq("job_preference_id", data.id);
    assert.deepEqual(authRows.map((r) => r.country_code), [selected.country_code]);

    const { data: readiness } = await user.client.rpc("get_onboarding_readiness");
    assert.equal(readiness.international_preferences_complete, true);
  });

  test("a non-relocation-market location is rejected as a relocation location", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [lebanonLocationSlug],
        p_work_authorization_status: "unsure",
      })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /invalid or unsupported/i);
  });

  test("a relocation-market location is rejected as a Lebanese preferred location", async () => {
    const { error } = await user.client.rpc(
      "save_job_preferences",
      baseSaveArgs({ p_work_arrangement: "onsite", p_location_ids: [relocationLocations[0].slug] })
    );
    assert.ok(error, "expected rejection");
    assert.match(error.message, /invalid or inactive/i);
  });
});

describe("Cross-user RLS: job_preference_relocation_locations / job_preference_authorized_countries", () => {
  let userA;
  let userB;

  before(async () => {
    userA = await createTestUser("relocauth-a");
    userB = await createTestUser("relocauth-b");
    await setPlan(userA.id, "pro", { status: "active", periodEnd: new Date(Date.now() + 86400000).toISOString() });
    await setPlan(userB.id, "pro", { status: "active", periodEnd: new Date(Date.now() + 86400000).toISOString() });

    // Give userB a real, full relocation configuration so there is a
    // legitimate job_preference_id + selected relocation location for
    // userA to attempt to attack.
    const { data, error } = await userB.client.rpc(
      "save_job_preferences",
      baseSaveArgs({
        p_international_search_enabled: true,
        p_willing_to_relocate: true,
        p_relocation_location_ids: [relocationLocations[0].slug],
        p_work_authorization_status: "already_authorized",
        p_work_authorization_country_ids: [relocationLocations[0].country_code],
      })
    );
    assert.equal(error, null, `userB setup save failed: ${error?.message}`);
    userB.jobPreferenceId = data.id;
  });
  after(async () => {
    await deleteTestUsers([userA, userB]);
  });

  test("userA cannot INSERT a relocation location row against userB's job_preference_id", async () => {
    const { error } = await userA.client.from("job_preference_relocation_locations").insert({
      job_preference_id: userB.jobPreferenceId,
      location_id: relocationLocations[1]?.slug ?? relocationLocations[0].slug,
    });
    assert.ok(error, "userA's insert against userB's job_preference_id must be rejected");
  });

  test("userA cannot DELETE userB's relocation location row", async () => {
    const { error } = await userA.client
      .from("job_preference_relocation_locations")
      .delete()
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.equal(error, null, "RLS silently filters rather than erroring on a scoped delete with no matching own-rows");

    const { data: stillThere } = await adminClient
      .from("job_preference_relocation_locations")
      .select("location_id")
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.equal(stillThere.length, 1, "userB's relocation location row must be untouched by userA's delete attempt");
  });

  test("userA cannot SELECT userB's relocation locations or authorized countries", async () => {
    const { data: seenRelocations } = await userA.client
      .from("job_preference_relocation_locations")
      .select("location_id")
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.equal(seenRelocations.length, 0, "userA must never see userB's relocation locations");

    const { data: seenCountries } = await userA.client
      .from("job_preference_authorized_countries")
      .select("country_code")
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.equal(seenCountries.length, 0, "userA must never see userB's authorized countries");
  });

  test("userA cannot INSERT an authorized-country row against userB's job_preference_id", async () => {
    const { error } = await userA.client.from("job_preference_authorized_countries").insert({
      job_preference_id: userB.jobPreferenceId,
      country_code: relocationLocations[0].country_code,
    });
    assert.ok(error, "userA's insert against userB's job_preference_id must be rejected");
  });

  test("no UPDATE policy exists for either child table — even the owning user cannot UPDATE a row in place", async () => {
    const { error: relocUpdateErr } = await userB.client
      .from("job_preference_relocation_locations")
      .update({ location_id: relocationLocations[0].slug })
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.ok(relocUpdateErr, "no UPDATE grant/policy exists for job_preference_relocation_locations — even the owner's own row must be rejected (delete + re-insert is the only supported path, via save_job_preferences)");

    const { error: authUpdateErr } = await userB.client
      .from("job_preference_authorized_countries")
      .update({ country_code: relocationLocations[0].country_code })
      .eq("job_preference_id", userB.jobPreferenceId);
    assert.ok(authUpdateErr, "no UPDATE grant/policy exists for job_preference_authorized_countries");
  });
});

// Student-to-Pro upgrade pricing, price versioning, and the mid-period
// price-change guarantees now live in
// tests/db/price-versioning-and-upgrade.test.mjs (moved out of this file
// so pricing/billing coverage is grouped in one place — see that file's
// header for the full list of guarantees it proves).
