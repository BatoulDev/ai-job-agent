// DB integration tests: location validation for flexible work arrangement.
// Covers both save_job_preferences RPC enforcement and
// get_onboarding_readiness preferences_complete computation.
// Fixed by: supabase/migrations/20260819100000_flexible_requires_location.sql
//
// Run: node --test tests/db/preferences-location-validation.test.mjs
// (requires a running local Supabase project with all migrations applied)

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

let userA; // save_job_preferences tests
let userB; // get_onboarding_readiness tests (full profile configured)
let roleSlug; // one active target_role slug
let locationSlug; // one active location slug

before(async () => {
  await assertExpectedLocalProject();
  [userA, userB] = await Promise.all([
    createTestUser("loc-val-a"),
    createTestUser("loc-val-b"),
  ]);

  // Fetch one active role and one active location for use in tests
  const [roleRes, locRes] = await Promise.all([
    adminClient.from("target_roles").select("slug").eq("is_active", true).limit(1),
    adminClient.from("locations").select("slug").eq("is_active", true).limit(1),
  ]);
  assert.ok(
    roleRes.data && roleRes.data.length > 0,
    "Need at least 1 active target_roles row to run these tests"
  );
  assert.ok(
    locRes.data && locRes.data.length > 0,
    "Need at least 1 active locations row to run these tests"
  );
  roleSlug = roleRes.data[0].slug;
  locationSlug = locRes.data[0].slug;

  // Configure userB with a complete profile so get_onboarding_readiness
  // can compute preferences_complete accurately
  await adminClient
    .from("profiles")
    .update({
      country_of_residence: "LB",
      custom_university: "Test University",
      custom_major: "Computer Science",
    })
    .eq("id", userB.id);
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function savePrefs(userClient, overrides = {}) {
  const defaults = {
    p_work_arrangement: "remote",
    p_job_market_coverage: null,
    p_job_type: "full-time",
    p_experience_level: "junior",
    p_additional_notes: null,
    p_custom_target_roles: [],
    p_custom_locations: [],
    p_target_role_ids: [roleSlug],
    p_location_ids: [],
  };
  const { error } = await userClient.rpc("save_job_preferences", {
    ...defaults,
    ...overrides,
  });
  return error;
}

async function directUpsertPrefs(userId, fields) {
  // _location_slug is a sentinel for this helper, not a real column
  const { _location_slug, ...rawFields } = fields;
  // PostgreSQL array_length('{}', 1) returns null (not 0), which can propagate
  // to null in boolean expressions. Store null instead of empty arrays so the
  // DB sees IS NULL and short-circuits correctly.
  const dbFields = Object.fromEntries(
    Object.entries(rawFields).map(([k, v]) => [k, Array.isArray(v) && v.length === 0 ? null : v])
  );
  const { error } = await adminClient
    .from("job_preferences")
    .upsert({ user_id: userId, ...dbFields }, { onConflict: "user_id" });
  assert.equal(error, null, `directUpsertPrefs failed: ${error?.message}`);

  // Wipe join tables so location/role presence is fully controlled by fields
  const { data: row } = await adminClient
    .from("job_preferences")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (row) {
    await Promise.all([
      adminClient.from("job_preference_target_roles").delete().eq("job_preference_id", row.id),
      adminClient.from("job_preference_locations").delete().eq("job_preference_id", row.id),
    ]);
    // Insert location if slug provided
    if (_location_slug) {
      await adminClient
        .from("job_preference_locations")
        .insert({ job_preference_id: row.id, location_id: _location_slug });
    }
  }
}

async function getReadiness(userClient) {
  const { data, error } = await userClient.rpc("get_onboarding_readiness");
  assert.equal(error, null, `get_onboarding_readiness error: ${error?.message}`);
  return data;
}

// ── save_job_preferences: location rejection ──────────────────────────────────

describe("save_job_preferences: location requirement enforcement", () => {
  test("remote + no locations → save succeeds (location not required for remote)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "remote",
      p_location_ids: [],
      p_custom_locations: [],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });

  test("onsite + no locations → save rejected (existing behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "onsite",
      p_location_ids: [],
      p_custom_locations: [],
    });
    assert.ok(err, "expected rejection but save succeeded");
    assert.match(
      err.message,
      /location/i,
      "error message must mention location"
    );
  });

  test("hybrid + no locations → save rejected (existing behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "hybrid",
      p_location_ids: [],
      p_custom_locations: [],
    });
    assert.ok(err, "expected rejection but save succeeded");
    assert.match(err.message, /location/i);
  });

  test("flexible + no locations → save rejected (new behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [],
      p_custom_locations: [],
    });
    assert.ok(err, "expected rejection but save succeeded");
    assert.match(
      err.message,
      /location/i,
      "rejection message must mention location"
    );
  });

  test("flexible rejection message mentions Flexible arrangement", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [],
      p_custom_locations: [],
    });
    assert.ok(err, "expected rejection");
    assert.match(
      err.message,
      /flexible/i,
      "error message should mention Flexible so the caller knows which arrangement is affected"
    );
  });

  test("flexible + location_id → save succeeds (new behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [locationSlug],
      p_custom_locations: [],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });

  test("flexible + custom location only → save succeeds", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [],
      p_custom_locations: ["Beirut"],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });

  test("flexible + both location_id and custom location → save succeeds", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [locationSlug],
      p_custom_locations: ["Beirut"],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });

  test("onsite + custom location only → save succeeds (existing behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "onsite",
      p_location_ids: [],
      p_custom_locations: ["Hamra"],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });

  test("hybrid + location_id → save succeeds (existing behavior)", async () => {
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "hybrid",
      p_location_ids: [locationSlug],
      p_custom_locations: [],
    });
    assert.equal(err, null, `expected success but got: ${err?.message}`);
  });
});

// ── get_onboarding_readiness: preferences_complete with flexible ───────────────

describe("get_onboarding_readiness: preferences_complete for flexible arrangement", () => {
  test("remote + no locations → preferences_complete = true (location not required)", async () => {
    await directUpsertPrefs(userB.id, {
      work_arrangement: "remote",
      job_type: "full-time",
      experience_level: "junior",
      custom_target_roles: ["Software Engineer"],
      custom_locations: [],
    });
    const readiness = await getReadiness(userB.client);
    assert.equal(
      readiness.preferences_complete,
      true,
      "remote with no location should be preferences_complete"
    );
  });

  test("onsite + no locations → preferences_complete = false (regression: existing arrangement)", async () => {
    await directUpsertPrefs(userB.id, {
      work_arrangement: "onsite",
      job_type: "full-time",
      experience_level: "junior",
      custom_target_roles: ["Software Engineer"],
      custom_locations: [],
    });
    const readiness = await getReadiness(userB.client);
    assert.equal(
      readiness.preferences_complete,
      false,
      "onsite with no location must not be preferences_complete"
    );
  });

  test("flexible + no locations → preferences_complete = false (new behavior)", async () => {
    await directUpsertPrefs(userB.id, {
      work_arrangement: "flexible",
      job_type: "full-time",
      experience_level: "junior",
      custom_target_roles: ["Software Engineer"],
      custom_locations: [],
    });
    const readiness = await getReadiness(userB.client);
    assert.equal(
      readiness.preferences_complete,
      false,
      "flexible with no location must not be preferences_complete"
    );
  });

  test("flexible + has location → preferences_complete = true (new behavior)", async () => {
    // Save via RPC to satisfy the location constraint
    const err = await savePrefs(userB.client, {
      p_work_arrangement: "flexible",
      p_location_ids: [locationSlug],
      p_custom_locations: [],
      p_target_role_ids: [roleSlug],
      p_custom_target_roles: [],
    });
    assert.equal(err, null, `setup save failed: ${err?.message}`);

    const readiness = await getReadiness(userB.client);
    assert.equal(
      readiness.preferences_complete,
      true,
      "flexible with a location must be preferences_complete"
    );
  });

  test("hybrid + has location → preferences_complete = true (regression: existing arrangement)", async () => {
    await directUpsertPrefs(userB.id, {
      work_arrangement: "hybrid",
      job_type: "full-time",
      experience_level: "junior",
      custom_target_roles: ["Software Engineer"],
      custom_locations: [],
      _location_slug: locationSlug,
    });
    const readiness = await getReadiness(userB.client);
    assert.equal(
      readiness.preferences_complete,
      true,
      "hybrid with a location must be preferences_complete"
    );
  });
});
