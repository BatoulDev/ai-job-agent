// tests/db/preferences-version-exactness.test.mjs
//
// Regression coverage for a second effect of the same defect fixed by
// supabase/migrations/20260824170000_fix_job_preferences_account_deletion_cascade.sql:
// before that migration, bump_job_preferences_version_for_child() fired once
// per INSERTed/DELETEd child row (job_preference_target_roles /
// job_preference_locations), each issuing its own
// "job_preferences.version = version + 1" UPDATE — on top of the single
// intended bump save_job_preferences already performs via
// selection_version (20260818090000). A single logical save that replaced
// several roles/locations at once therefore bumped .version by far more
// than 1, silently violating "a meaningful preference change triggers at
// most one intended version increment per logical save." The existing
// tests/db/preferences-version-bump.test.mjs only asserted `version >
// before` (which the old buggy behavior also satisfied), so it never caught
// this. These tests assert the exact delta.
//
// Run: node --test tests/db/preferences-version-exactness.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers } from "./helpers.mjs";

let user;
let roleSlugs;
let locationSlugs;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("pref-version-exact");

  const [rolesResult, locsResult] = await Promise.all([
    adminClient.from("target_roles").select("slug").eq("is_active", true).limit(2),
    adminClient.from("locations").select("slug").eq("is_active", true).limit(2),
  ]);
  assert.ok(rolesResult.data && rolesResult.data.length >= 2, "Need >= 2 active target_roles");
  assert.ok(locsResult.data && locsResult.data.length >= 2, "Need >= 2 active locations");
  roleSlugs = rolesResult.data.map((r) => r.slug);
  locationSlugs = locsResult.data.map((l) => l.slug);
});

after(async () => {
  await deleteTestUsers([user]);
});

async function savePrefs(overrides = {}) {
  const defaults = {
    p_work_arrangement: "remote",
    p_job_market_coverage: null,
    p_job_type: "full-time",
    p_experience_level: "junior",
    p_additional_notes: null,
    p_custom_target_roles: [],
    p_custom_locations: [],
    p_target_role_ids: [],
    p_location_ids: [],
    p_lebanon_location_scope: "selected_only",
  };
  const { error } = await user.client.rpc("save_job_preferences", { ...defaults, ...overrides });
  assert.equal(error, null, `save_job_preferences failed: ${error?.message}`);
}

async function getVersion() {
  const { data, error } = await adminClient
    .from("job_preferences")
    .select("id, version, selection_version")
    .eq("user_id", user.id)
    .maybeSingle();
  assert.equal(error, null, `getVersion error: ${error?.message}`);
  return data;
}

describe("save_job_preferences: exactly-once version increment per logical save", () => {
  // work_arrangement is held constant at "onsite" for every save after the
  // first, deliberately, so every subsequent delta isolates ONLY the
  // join-table (role/location) change path — bump_job_preferences_version's
  // direct-column comparison and the selection_version-driven comparison
  // are two independently-triggered UPDATE statements by design (the
  // upsert, then a separate selection_version bump), so a save that changes
  // BOTH a direct column AND the role/location selection legitimately bumps
  // version by 2, not 1 — that is unrelated to the defect this migration
  // fixes. What this migration's fix eliminates is any EXTRA bump beyond
  // that: before 20260824170000, each individual child-row INSERT/DELETE
  // fired its own additional "version = version + 1" UPDATE on top of the
  // one intended selection_version-driven bump.
  test("initial save: onsite, 1 role, 1 location", async () => {
    await savePrefs({
      p_work_arrangement: "onsite",
      p_target_role_ids: [roleSlugs[0]],
      p_location_ids: [locationSlugs[0]],
    });
    const prefs = await getVersion();
    assert.ok(prefs, "job_preferences row must exist");
  });

  test("adding a second role AND a second location in ONE save (same work_arrangement) bumps version by exactly 1", async () => {
    const before_ = await getVersion();

    await savePrefs({
      p_work_arrangement: "onsite",
      p_target_role_ids: [...roleSlugs],
      p_location_ids: [...locationSlugs],
    });

    const after_ = await getVersion();
    assert.equal(
      after_.version,
      before_.version + 1,
      `version must increase by exactly 1 for one logical save that adds 1 role + 1 location, with no direct-column ` +
        `change (before=${before_.version}, after=${after_.version}). A larger delta means a per-child-row trigger is still firing.`
    );
    assert.equal(after_.selection_version, before_.selection_version + 1, "selection_version must increase by exactly 1");

    const [roleCount, locCount] = await Promise.all([
      adminClient.from("job_preference_target_roles").select("target_role_id", { count: "exact", head: true }).eq("job_preference_id", after_.id),
      adminClient.from("job_preference_locations").select("location_id", { count: "exact", head: true }).eq("job_preference_id", after_.id),
    ]);
    assert.equal(roleCount.count, roleSlugs.length);
    assert.equal(locCount.count, locationSlugs.length);
  });

  test("shrinking from 2 roles/2 locations to 1 role/1 location in ONE save bumps version by exactly 1", async () => {
    const before_ = await getVersion();

    await savePrefs({
      p_work_arrangement: "onsite",
      p_target_role_ids: [roleSlugs[0]],
      p_location_ids: [locationSlugs[0]],
    });

    const after_ = await getVersion();
    assert.equal(
      after_.version,
      before_.version + 1,
      `version must increase by exactly 1 for one logical save that removes 1 role + 1 location, with no direct-column ` +
        `change (before=${before_.version}, after=${after_.version})`
    );
  });

  test("re-saving identical roles/locations does not bump version at all", async () => {
    const before_ = await getVersion();

    await savePrefs({
      p_work_arrangement: "onsite",
      p_target_role_ids: [roleSlugs[0]],
      p_location_ids: [locationSlugs[0]],
    });

    const after_ = await getVersion();
    assert.equal(after_.version, before_.version, "identical re-save must not bump version");
    assert.equal(after_.selection_version, before_.selection_version, "identical re-save must not bump selection_version");
  });

  test("a save that changes BOTH a direct column and the role/location selection bumps version by exactly 2 (two intended bumps, not more)", async () => {
    const before_ = await getVersion();

    await savePrefs({
      p_work_arrangement: "onsite",
      p_job_type: "part-time",
      p_target_role_ids: [...roleSlugs],
      p_location_ids: [locationSlugs[0]],
    });

    const after_ = await getVersion();
    assert.equal(
      after_.version,
      before_.version + 2,
      `a combined direct-column + role change must bump version by exactly 2 (one BEFORE-trigger firing from the ` +
        `upsert's direct-column UPDATE, one from the separate selection_version UPDATE) — not more ` +
        `(before=${before_.version}, after=${after_.version})`
    );
  });
});
