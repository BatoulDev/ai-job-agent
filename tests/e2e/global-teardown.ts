import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./loadEnv";

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY!;
const FIXTURE_PATH = resolve(__dirname, ".fixture.json");
const JMC_FIXTURE_PATH = resolve(__dirname, ".fixture-job-market-coverage.json");

export default async function globalTeardown() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (existsSync(FIXTURE_PATH)) {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

    await admin.from("application_outcomes").delete().eq("user_id", fixture.userId);
    await admin.from("applications").delete().eq("user_id", fixture.userId);
    await admin.from("cover_letters").delete().eq("user_id", fixture.userId);
    await admin.from("matches").delete().eq("user_id", fixture.userId);
    if (Array.isArray(fixture.jobIds) && fixture.jobIds.length > 0) {
      await admin.from("jobs").delete().in("id", fixture.jobIds);
    }
    await admin.auth.admin.deleteUser(fixture.userId);

    unlinkSync(FIXTURE_PATH);
  }

  if (existsSync(JMC_FIXTURE_PATH)) {
    const jmcFixture = JSON.parse(readFileSync(JMC_FIXTURE_PATH, "utf8"));
    await admin.from("job_preferences").delete().eq("user_id", jmcFixture.userId);
    await admin.auth.admin.deleteUser(jmcFixture.userId);
    unlinkSync(JMC_FIXTURE_PATH);
  }
}
