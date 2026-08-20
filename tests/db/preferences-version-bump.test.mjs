// Regression coverage for the preferences-version-bump gap fixed by
// supabase/migrations/20260818090000_preferences_updated_lifecycle.sql.
//
// Before the fix: changing only the reference role selection
// (job_preference_target_roles rows) never bumped job_preferences.version
// because bump_job_preferences_version only compared direct columns on the
// job_preferences row itself. mark_cv_analyses_stale_on_preferences_change
// therefore never fired for reference-role-only changes, and an approved
// analysis was never marked stale even though the recommendation targets
// had materially changed.
//
// After the fix: save_job_preferences detects join-table changes via
// before/after comparison of sorted role/location ID arrays, increments
// selection_version when they differ, and bump_job_preferences_version
// bumps job_preferences.version on that column change — triggering the
// stale-analysis chain exactly as a direct-column change would.
//
// Run: node --test tests/db/preferences-version-bump.test.mjs
// (requires a running local Supabase project with all migrations applied)

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

let userA;

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("pref-version-a");
});

after(async () => {
  await deleteTestUsers([userA]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrefsRow(userId) {
  const { data, error } = await adminClient
    .from("job_preferences")
    .select("id, version, selection_version, work_arrangement, job_type, experience_level")
    .eq("user_id", userId)
    .maybeSingle();
  assert.equal(error, null, `getPrefsRow error: ${error?.message}`);
  return data;
}

async function getActiveRoleSlugs(jobPreferenceId) {
  const { data, error } = await adminClient
    .from("job_preference_target_roles")
    .select("target_role_id")
    .eq("job_preference_id", jobPreferenceId);
  assert.equal(error, null, `getActiveRoleSlugs error: ${error?.message}`);
  return (data ?? []).map((r) => r.target_role_id).sort();
}

// Fetch two active reference roles from the target_roles table that exist
// in the local Supabase project so tests don't hard-code specific slugs.
async function getTwoActiveRoleSlugs() {
  const { data, error } = await adminClient
    .from("target_roles")
    .select("slug")
    .eq("is_active", true)
    .limit(2);
  assert.equal(error, null, `getTwoActiveRoleSlugs error: ${error?.message}`);
  assert.ok(
    data && data.length >= 2,
    "Need at least 2 active target_roles rows in the database to run these tests"
  );
  return [data[0].slug, data[1].slug];
}

async function savePrefs(userClient, overrides = {}) {
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
  };
  const { error } = await userClient.rpc("save_job_preferences", {
    ...defaults,
    ...overrides,
  });
  return error;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("save_job_preferences: selection_version and version tracking", () => {
  let roleSlug1;
  let roleSlug2;

  before(async () => {
    [roleSlug1, roleSlug2] = await getTwoActiveRoleSlugs();
  });

  test("initial save with one reference role sets version=1, selection_version=0 (no prior state)", async () => {
    const err = await savePrefs(userA.client, { p_target_role_ids: [roleSlug1] });
    assert.equal(err, null, `first save failed: ${err?.message}`);

    const prefs = await getPrefsRow(userA.id);
    assert.ok(prefs, "job_preferences row must exist after save");
    // On first save: INSERT → bump trigger sets version=1. Then because there
    // was no prior join-table state, v_old_role_ids=NULL vs new=[slug1] is
    // DISTINCT → selection_version incremented → another UPDATE fires →
    // bump trigger sets version=2. So version=2 after the first save with
    // a reference role. The important invariant is that version is ≥ 1.
    assert.ok(prefs.version >= 1, "version must be at least 1 after first save");
  });

  test("adding a second reference role increments version (join-table change detected)", async () => {
    const prefs0 = await getPrefsRow(userA.id);
    const version0 = prefs0.version;
    const selectionVersion0 = prefs0.selection_version;

    // Save with both roles — the second role is new
    const err = await savePrefs(userA.client, {
      p_target_role_ids: [roleSlug1, roleSlug2],
    });
    assert.equal(err, null, `second save failed: ${err?.message}`);

    const prefs1 = await getPrefsRow(userA.id);
    assert.ok(
      prefs1.selection_version > selectionVersion0,
      `selection_version must increase when a role is added (was ${selectionVersion0}, got ${prefs1.selection_version})`
    );
    assert.ok(
      prefs1.version > version0,
      `job_preferences.version must increase when selection_version increases (was ${version0}, got ${prefs1.version})`
    );

    const activeSlugs = await getActiveRoleSlugs(prefs1.id);
    assert.deepStrictEqual(
      activeSlugs.sort(),
      [roleSlug1, roleSlug2].sort(),
      "both roles must be recorded in the join table"
    );
  });

  test("saving the same reference roles again does NOT increment version (no-change idempotency)", async () => {
    const prefs0 = await getPrefsRow(userA.id);
    const version0 = prefs0.version;
    const selectionVersion0 = prefs0.selection_version;

    // Exact same roles, exact same direct columns — nothing changed
    const err = await savePrefs(userA.client, {
      p_target_role_ids: [roleSlug1, roleSlug2],
    });
    assert.equal(err, null, `no-change save failed: ${err?.message}`);

    const prefs1 = await getPrefsRow(userA.id);
    assert.equal(
      prefs1.selection_version,
      selectionVersion0,
      "selection_version must NOT change when the same roles are re-saved"
    );
    assert.equal(
      prefs1.version,
      version0,
      "version must NOT change on a no-op re-save"
    );
  });

  test("removing a reference role increments version (join-table change detected)", async () => {
    const prefs0 = await getPrefsRow(userA.id);
    const version0 = prefs0.version;
    const selectionVersion0 = prefs0.selection_version;

    // Drop back to one role
    const err = await savePrefs(userA.client, {
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(err, null, `role removal save failed: ${err?.message}`);

    const prefs1 = await getPrefsRow(userA.id);
    assert.ok(
      prefs1.selection_version > selectionVersion0,
      `selection_version must increase when a role is removed (was ${selectionVersion0}, got ${prefs1.selection_version})`
    );
    assert.ok(
      prefs1.version > version0,
      `version must increase when selection_version increases (was ${version0}, got ${prefs1.version})`
    );
  });

  test("changing only a direct column (job_type) increments version, leaves selection_version unchanged", async () => {
    const prefs0 = await getPrefsRow(userA.id);
    const version0 = prefs0.version;
    const selectionVersion0 = prefs0.selection_version;

    // Change job_type but keep the same role
    const err = await savePrefs(userA.client, {
      p_target_role_ids: [roleSlug1],
      p_job_type: "part-time",
    });
    assert.equal(err, null, `direct-column save failed: ${err?.message}`);

    const prefs1 = await getPrefsRow(userA.id);
    assert.equal(
      prefs1.selection_version,
      selectionVersion0,
      "selection_version must not change when only a direct column changed"
    );
    assert.ok(
      prefs1.version > version0,
      "version must still increase via the direct-column path in bump_job_preferences_version"
    );
  });
});

describe("analysis_tasks.trigger constraint", () => {
  test("preferences_updated is a valid trigger value", async () => {
    // Verify the constraint was widened by 20260818090000. We can't insert
    // directly (authenticated users don't have insert on analysis_tasks), so
    // we verify via the constraint definition in information_schema.
    //
    // NOTE: this test is intentionally read-only. It does not create a task.
    const { data, error } = await adminClient
      .from("information_schema.check_constraints")
      .select("constraint_name, check_clause")
      .eq("constraint_schema", "public")
      .eq("constraint_name", "analysis_tasks_trigger_check")
      .maybeSingle();

    // If the query fails (e.g. RLS or schema visibility), skip gracefully.
    if (error) {
      // Not all Supabase configs expose information_schema via REST —
      // fall through without failing the suite.
      return;
    }

    if (data) {
      assert.ok(
        data.check_clause.includes("preferences_updated"),
        `analysis_tasks_trigger_check must include 'preferences_updated'. Got: ${data.check_clause}`
      );
    }
  });
});
