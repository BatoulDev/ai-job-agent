// tests/db/preferences-seed-fixture-version-artifact.test.mjs
//
// Regression test for a version-bump anomaly observed on the local fixture
// user "Zain Khalil" (scripts/seed-local-automation-users.mjs): the very
// first real save_job_preferences() call through the app UI bumped
// job_preferences.version from 1 to 2, even though every field the user
// submitted was identical to the seeded values.
//
// Root cause (confirmed by reading supabase/migrations/20260806090100_
// create_save_job_preferences_rpc.sql and its 20260818090000 replacement):
// save_job_preferences computes custom_target_roles/custom_locations via
// `array_agg(...) from deduped` — a Postgres aggregate over zero rows
// returns NULL, not an empty array, when the caller submits no custom
// entries. scripts/seed-local-automation-users.mjs writes
// `custom_target_roles: fixture.customTargetRoles ?? []` directly via a
// service-role upsert (it cannot call the security-invoker RPC — see the
// comment above ensurePreferences() in that script) — for fixtures with no
// custom entries this stores an empty ARRAY ('{}'), not NULL.
//
// bump_job_preferences_version() then evaluates
// `new.custom_target_roles is distinct from old.custom_target_roles`.
// NULL IS DISTINCT FROM '{}' is TRUE in Postgres, so the first RPC-based
// save (which writes NULL) appears to "change" a column that seeded as
// '{}', bumping version even though nothing the user controls changed.
//
// This is a seed/fixture-only artifact, not an RPC or product defect: a
// real user's job_preferences row is always *created* by this same RPC
// (first save goes through save_job_preferences too), so it starts NULL
// and stays NULL across every subsequent no-custom-entries save — old and
// new are both NULL, IS DISTINCT FROM is false, no spurious bump. The
// mismatch only exists because the seed script's direct-insert convention
// diverges from what the RPC itself would have written.
//
// This test proves the mechanism directly: seed a job_preferences row the
// same way the fixture script does (custom_target_roles/custom_locations
// as '{}', bypassing the RPC), then call save_job_preferences with
// semantically-identical (empty-custom-entries) values and assert the
// version bump. A second scenario proves a row created by the RPC itself
// (the real-user path) does NOT exhibit the anomaly.
//
// Run: node --test tests/db/preferences-seed-fixture-version-artifact.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers } from "./helpers.mjs";

let seededUser;
let rpcOnlyUser;

before(async () => {
  await assertExpectedLocalProject();
  seededUser = await createTestUser("pref-seed-artifact");
  rpcOnlyUser = await createTestUser("pref-rpc-only");
});

after(async () => {
  await deleteTestUsers([seededUser, rpcOnlyUser]);
});

async function getRow(userId) {
  const { data, error } = await adminClient
    .from("job_preferences")
    .select("id, version, custom_target_roles, custom_locations")
    .eq("user_id", userId)
    .maybeSingle();
  assert.equal(error, null, `getRow error: ${error?.message}`);
  return data;
}

describe("job_preferences version-bump anomaly: seed-fixture artifact, not a product defect", () => {
  test("reproduction: a row seeded like scripts/seed-local-automation-users.mjs ('{}' custom arrays) bumps version on the first identical RPC re-save", async () => {
    // Mirrors ensurePreferences() in scripts/seed-local-automation-users.mjs
    // exactly: direct service-role upsert with custom arrays defaulted to
    // `[]` rather than left absent/null.
    const { error: seedError } = await adminClient.from("job_preferences").insert({
      user_id: seededUser.id,
      work_arrangement: "remote",
      job_market_coverage: null,
      job_type: "full-time",
      experience_level: "junior",
      additional_notes: null,
      custom_target_roles: [],
      custom_locations: [],
    });
    assert.equal(seedError, null, `seed insert error: ${seedError?.message}`);

    const seeded = await getRow(seededUser.id);
    assert.equal(seeded.version, 1, "INSERT trigger path always sets version = 1");
    assert.deepEqual(seeded.custom_target_roles, [], "seed writes an empty ARRAY, not null");
    assert.deepEqual(seeded.custom_locations, [], "seed writes an empty ARRAY, not null");

    // The user now saves via the real product/RPC path with values that are
    // semantically identical to the seed (same work_arrangement/job_type/
    // experience_level, no custom roles or locations submitted).
    const { error: rpcError } = await seededUser.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(rpcError, null, `save_job_preferences failed: ${rpcError?.message}`);

    const afterSave = await getRow(seededUser.id);
    assert.equal(afterSave.custom_target_roles, null, "the RPC's own array_agg-over-zero-rows always produces NULL for empty custom entries");
    assert.equal(afterSave.custom_locations, null, "same NULL-producing behavior for custom_locations");
    assert.equal(
      afterSave.version,
      2,
      "confirms the anomaly: version bumps from 1 to 2 solely because seed wrote '{}' " +
        "while the RPC writes NULL for the same semantic 'no custom entries' state " +
        "(NULL IS DISTINCT FROM '{}' is true in Postgres)"
    );
  });

  test("control: a row created by save_job_preferences itself never exhibits the anomaly — a real user's first save is unaffected", async () => {
    const { error: firstError } = await rpcOnlyUser.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(firstError, null, `first save_job_preferences failed: ${firstError?.message}`);

    const afterFirst = await getRow(rpcOnlyUser.id);
    assert.equal(afterFirst.version, 1, "first-ever save (INSERT path) is always version 1");
    assert.equal(afterFirst.custom_target_roles, null, "RPC-created row starts NULL, matching what every later empty-custom save will also write");
    assert.equal(afterFirst.custom_locations, null);

    // Re-save with identical (still empty-custom-entries) values — the
    // real-user no-op case the fixture anomaly was mistaken for.
    const { error: secondError } = await rpcOnlyUser.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(secondError, null, `second save_job_preferences failed: ${secondError?.message}`);

    const afterSecond = await getRow(rpcOnlyUser.id);
    assert.equal(afterSecond.version, 1, "a genuinely no-op re-save must NOT bump version for a real user (NULL IS DISTINCT FROM NULL is false)");
  });
});
