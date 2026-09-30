// DB tests for the founder-confirmed daily-new-match-limit values (Model C,
// 2026-09-30): Student = 5, Pro = 10, Free unchanged (NULL — no new Free
// decision made). See
// supabase/migrations/20260930160000_add_model_c_active_capacity_and_daily_limits.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

test("public.plans: student's daily_new_match_limit is the founder-confirmed 5", async () => {
  await assertExpectedLocalProject();
  const { data, error } = await adminClient.from("plans").select("daily_new_match_limit").eq("plan_code", "student").single();
  assert.equal(error, null);
  assert.equal(data.daily_new_match_limit, 5);
});

test("public.plans: pro's daily_new_match_limit is the founder-confirmed 10", async () => {
  const { data, error } = await adminClient.from("plans").select("daily_new_match_limit").eq("plan_code", "pro").single();
  assert.equal(error, null);
  assert.equal(data.daily_new_match_limit, 10);
});

test("public.plans: free's daily_new_match_limit is NULL — no new Free product decision was made; this preserves existing behavior", async () => {
  const { data, error } = await adminClient.from("plans").select("daily_new_match_limit").eq("plan_code", "free").single();
  assert.equal(error, null);
  assert.equal(data.daily_new_match_limit, null);
});
