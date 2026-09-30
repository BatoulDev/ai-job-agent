/**
 * Job Expiry Sweep — n8n Workflow SDK source
 *
 * Model C (founder decision, 2026-09-30): "expired jobs must disappear from
 * active user results... We do NOT want jobs to remain visible for days
 * after they are closed." This is the scheduled half of that requirement —
 * the source-refresh half (stale-close on a missing listing) already
 * exists and is unchanged, see src/lib/ingestion/ingestSourceBatch.ts.
 *
 * ALL this workflow does is call the already-idempotent, already-tested
 * public.expire_due_jobs() RPC (supabase/migrations/20260930160000_add_
 * model_c_active_capacity_and_daily_limits.sql) on an hourly schedule. No
 * business logic lives in this file — the RPC is the single authoritative
 * implementation (tests/db/job-expiry-sweep.test.mjs).
 *
 * STATUS: PREPARED, NOT ACTIVATED. This workflow must stay `active: false`
 * in job-expiry-sweep.json until a human explicitly authorizes production
 * scheduling — see this file's own comment at the bottom and
 * docs/PRODUCT_MATCHING_RULES.md's "Job lifecycle" section for the exact
 * activation steps.
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * The n8n MCP write-path tools are blocked by a pre-tool hook script that
 * fails on Windows paths with spaces (same limitation noted in every other
 * workflow in this directory). Import the companion JSON file instead:
 *   n8n UI → (hamburger menu) → Import from File → job-expiry-sweep.json
 *
 * CREDENTIALS (configure in n8n → Settings → Credentials before activating)
 * ──────────────────────────────────────────────────────────────────────────
 *   Type: Supabase, Name: "Supabase Service Role" — the SAME credential
 *   cv-analysis-worker.ts already documents and uses. expire_due_jobs() is
 *   service_role-only (revoked from public/authenticated — see the
 *   migration), so this credential is required; no other secret is needed.
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before activating)
 * ──────────────────────────────────────────────────────────────────────────────────
 *   supabaseBaseUrl — local: http://host.docker.internal:55321. Same
 *   single-field-to-edit-per-environment pattern as every other workflow
 *   in this directory (see cv-analysis-worker.ts's own header for why
 *   n8n $env/$vars are not usable on this instance).
 *
 * SCHEDULE
 * ────────
 * Hourly (founder-recommended starting cadence, Part 9 of the brief):
 * cheap DB status update, no AI call, no provider request, closes the gap
 * between "job actually expired" and "job stops appearing as a fresh
 * opportunity" without waiting for the next ingestion run. The n8n
 * instance's effective timezone is UTC (confirmed in
 * source-intelligence-analyzer.ts's own header) — irrelevant here anyway,
 * since expire_due_jobs() compares real timestamptz columns
 * (expires_at/closing_date) against now(), not a wall-clock trigger time.
 *
 * ACTIVATION (future, explicit, separate authorization — NOT part of this change)
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Import job-expiry-sweep.json into the target n8n instance.
 *   2. Configure the "Supabase Service Role" credential for that environment.
 *   3. Edit the Workflow Configuration node's supabaseBaseUrl for that environment.
 *   4. Toggle the workflow active in the n8n UI.
 *   5. Optionally attach Settings → Error Workflow → "AI Job Guide - Error Handler"
 *      (manual per-workflow UI step, same as every other workflow here).
 * No step above has been performed by this change.
 */

import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const supabaseCred = newCredential('Supabase Service Role'); // type: supabaseApi

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Hourly Schedule Trigger',
    parameters: {
      rule: {
        interval: [{ field: 'hours', hoursInterval: 1 }],
      },
    },
    output: [{ json: {} }],
  },
});

const workflowConfig = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Workflow Configuration',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          {
            id: 'supabase-base-url',
            name: 'supabaseBaseUrl',
            value: 'http://host.docker.internal:55321',
            type: 'string',
          },
        ],
      },
    },
    output: [{ json: { supabaseBaseUrl: 'http://host.docker.internal:55321' } }],
  },
});

// The entire workflow: call the already-idempotent RPC. No payload needed —
// expire_due_jobs() takes no arguments and derives everything from real
// jobs.expires_at/closing_date columns compared against now().
const expireDueJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Expire Due Jobs',
    parameters: {
      method: 'POST',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/rpc/expire_due_jobs"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Accept', value: 'application/json' },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: {},
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ job_id: 'job-uuid' }] }],
  },
});

export default workflow('job-expiry-sweep', 'AI Job Guide - Job Expiry Sweep')
  .add(scheduleTrigger)
  .to(workflowConfig)
  .to(expireDueJobs);
