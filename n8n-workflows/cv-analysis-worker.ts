/**
 * CV Analysis Worker — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * The n8n MCP write-path tools are blocked by a pre-tool hook script that
 * fails on Windows paths with spaces. Import the companion JSON file instead:
 *   n8n UI → (hamburger menu) → Import from File → cv-analysis-worker.json
 *
 * CREDENTIALS (configure in n8n → Settings → Credentials before activating)
 * ──────────────────────────────────────────────────────────────────────────
 * Create two credentials and name them exactly as shown:
 *
 *   1. Type: Supabase, Name: "Supabase Service Role"
 *      Host: your Supabase project URL (e.g. https://abcdefgh.supabase.co)
 *      Service Role: your service-role secret key
 *
 *   2. Type: OpenAI, Name: "OpenAI"
 *      API Key: your OpenAI secret key (requires gpt-4o access)
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before activating)
 * ──────────────────────────────────────────────────────────────────────────────────
 *   supabaseBaseUrl — base URL of your Supabase project (no trailing slash)
 *                     local: http://host.docker.internal:55321
 *                     cloud: https://<project-ref>.supabase.co
 *   environment     — "local" or "production" (informational label)
 *
 *   All Supabase endpoint URLs read from this node via
 *   $('Workflow Configuration').first().json.supabaseBaseUrl
 *   so deployment only requires changing this one node and selecting the
 *   matching "Supabase Service Role" credential.
 *
 * REQUIRED MIGRATIONS (apply before activating — never apply remotely from here)
 * ────────────────────────────────────────────────────────────────────────────────
 *   supabase/migrations/20260811090000_restrict_cv_to_pdf.sql
 *   supabase/migrations/20260811090010_create_claim_analysis_task.sql
 *
 * CONCURRENCY MODEL
 * ─────────────────
 * This n8n instance runs in standard single-process mode. Within a single
 * workflow execution, tasks are processed SEQUENTIALLY one at a time (that is
 * what splitInBatches with batchSize=1 does — it is a serial loop, not a
 * parallel fan-out). BATCH_SIZE controls how many tasks are claimed per
 * execution, not how many run simultaneously.
 *
 * Effective pipeline parallelism comes from overlapping executions: if the
 * previous execution is still running when the 30-second trigger fires, n8n
 * starts a new execution alongside it. FOR UPDATE SKIP LOCKED in the claim
 * RPC guarantees each execution claims a disjoint set of tasks.
 *
 * To increase throughput beyond what overlapping executions provide, switch
 * to n8n Queue Mode (requires Redis and multiple worker processes) — no
 * workflow code changes are needed for that migration.
 *
 * DUPLICATE-INSERT SAFETY
 * ───────────────────────
 * cv_analyses is inserted with Prefer: resolution=ignore-duplicates. The only
 * unique constraint that triggers a silent skip is cv_analyses_analysis_task_id_key
 * (unique on analysis_task_id). That constraint can only conflict when the SAME
 * task is processed twice (idempotent retry after a task-status-update failure).
 * An approved or current analysis row belongs to a different task and a different
 * analysis_task_id — it is never affected. The workflow never sets is_current=true
 * or review_status='approved', so a silently ignored insert never overwrites or
 * demotes an approved profile. Build Task Update correctly treats a silent ignore
 * (no error, parseSucceeded=true) as a completed task.
 */

import {
  workflow,
  node,
  trigger,
  splitInBatches,
  nextBatch,
  newCredential,
  expr,
} from '@n8n/workflow-sdk';

// BATCH_SIZE: how many tasks are claimed per execution (not concurrency).
// Increase to drain the queue faster per execution; the per-task runtime is
// unaffected since tasks in a single execution are still processed serially.
const BATCH_SIZE    = 3;
const LEASE_MINUTES = 10;  // minutes before a stuck processing task is retried

// ─────────────────────────────────────────────────────────────────────────────
// Credentials — named references only; no secret values in this file
// ─────────────────────────────────────────────────────────────────────────────
const supabaseCred = newCredential('Supabase Service Role');  // type: supabaseApi
const openAiCred   = newCredential('OpenAI');                  // type: openAiApi

// ─────────────────────────────────────────────────────────────────────────────
// Trigger: poll the queue every 30 seconds.
// ─────────────────────────────────────────────────────────────────────────────
const pollTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Poll Queue Every 5s',
    parameters: {
      rule: {
        interval: [{ field: 'seconds', secondsInterval: 5 }]
      }
    },
    output: [{ json: {} }]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Configuration: all non-secret deployment values in one place.
// Change supabaseBaseUrl and the selected credential to redeploy to any env.
// ─────────────────────────────────────────────────────────────────────────────
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
            type: 'string'
          },
          {
            id: 'environment-field',
            name: 'environment',
            value: 'local',
            type: 'string'
          }
        ]
      },
      options: {}
    },
    output: [{ json: { supabaseBaseUrl: 'http://host.docker.internal:55321', environment: 'local' } }]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Permanently fail tasks stuck past their lease AND with attempt_count
// >= max_attempts. Call first so the per-CV unique index slot is freed before
// claim_analysis_task tries to insert a new active task for the same CV.
// ─────────────────────────────────────────────────────────────────────────────
const failStuckTasks = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fail Stuck Tasks',
    continueOnFail: true,
    parameters: {
      method: 'POST',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/rpc/fail_stale_analysis_tasks"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { p_lease_minutes: LEASE_MINUTES }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: { count: 0 } }]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Claim up to BATCH_SIZE tasks atomically.
// Returns an array of task rows; each will be processed serially in the loop.
// ─────────────────────────────────────────────────────────────────────────────
const claimBatch = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Claim Task Batch',
    parameters: {
      method: 'POST',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/rpc/claim_analysis_task"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Accept', value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { p_batch_size: BATCH_SIZE }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ id: 'task-uuid', user_id: 'user-uuid', cv_id: 'cv-uuid', attempt_count: 1, max_attempts: 3 }] }]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Split the array into individual items. Returns [] when no tasks were
// claimed; the loop no-ops naturally on empty input (no gating IF needed).
// ─────────────────────────────────────────────────────────────────────────────
const splitTasks = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Split Tasks',
    parameters: {
      jsCode: `
const tasks = [];
for (const item of $input.all()) {
  const t = item.json;
  // n8n HTTP Request v4.4 unwraps JSON array responses into individual items,
  // so each claimed task arrives as a separate item (confirmed in execution #51).
  // The array branch below guards against any future n8n version that returns
  // the whole array as a single item's json.
  if (Array.isArray(t)) {
    for (const task of t) {
      if (task && typeof task === 'object' && task.id && task.user_id && task.cv_id) {
        tasks.push({ json: task });
      }
    }
  } else if (t && typeof t === 'object' && t.id && t.user_id && t.cv_id) {
    tasks.push({ json: t });
  }
}
return tasks;
`
    },
    output: [
      { json: { id: 'task-uuid', user_id: 'user-uuid', cv_id: 'cv-uuid', attempt_count: 1, max_attempts: 3 } }
    ]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Loop — one task per iteration, processed sequentially.
// A failure in task N is caught and written back before task N+1 starts.
// ─────────────────────────────────────────────────────────────────────────────
const batchLoop = splitInBatches({
  version: 3,
  config: {
    name: 'For Each Task',
    parameters: { batchSize: 1 }
  }
});

// ── 4a. Load CV row — validates user_id ownership server-side ─────────────────
const loadCvRow = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load CV Row',
    continueOnFail: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/cvs?id=eq.{{ $json.cv_id }}&user_id=eq.{{ $json.user_id }}&select=id,storage_path,mime_type,is_active,file_name&limit=1"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ id: 'cv-uuid', storage_path: 'user-uuid/file.pdf', mime_type: 'application/pdf', is_active: true, file_name: 'cv.pdf' }] }]
  }
});

// ── 4b. Validate CV and extract context for downstream nodes ──────────────────
// FIX (#52): n8n HTTP Request v4.4 unwraps single-element JSON arrays into
// individual items. The CV row therefore arrives as a direct object, not an
// array. The old code used Array.isArray(rows) ? rows[0] : null which set
// cvRow=null for a direct object, falsely triggering "CV record not found".
const validateCvContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate CV Context',
    continueOnFail: true,
    parameters: {
      jsCode: `
const taskCtx = $('Split Tasks').item.json;

if ($input.item.json?.error) {
  throw new Error('RETRYABLE: CV row load failed: ' + JSON.stringify($input.item.json.error));
}

const rows = $input.item.json;
// n8n HTTP Request v4.4 unwraps single-element JSON arrays into individual items.
// The CV row therefore arrives as a direct object, not an array. Accept both shapes.
const cvRow = Array.isArray(rows)
  ? (rows[0] ?? null)
  : (rows && typeof rows === 'object' && rows.id ? rows : null);

if (!cvRow) {
  throw new Error('PERMANENT: CV record not found for cv_id=' + taskCtx.cv_id);
}
if (cvRow.id !== taskCtx.cv_id) {
  throw new Error('PERMANENT: CV id mismatch: expected ' + taskCtx.cv_id + ' got ' + cvRow.id);
}
if (!cvRow.is_active) {
  throw new Error('PERMANENT: CV is no longer active (cv_id=' + taskCtx.cv_id + ')');
}
if (!cvRow.storage_path || typeof cvRow.storage_path !== 'string' || !cvRow.storage_path.trim()) {
  throw new Error('PERMANENT: CV has no valid storage_path (cv_id=' + taskCtx.cv_id + ')');
}
if (cvRow.mime_type !== 'application/pdf') {
  throw new Error('PERMANENT: Unsupported MIME type: ' + cvRow.mime_type);
}

return [{
  json: {
    taskId:          taskCtx.id,
    taskTrigger:     taskCtx.trigger || null,
    userId:          taskCtx.user_id,
    cvId:            taskCtx.cv_id,
    cvStoragePath:   cvRow.storage_path,
    cvMimeType:      cvRow.mime_type,
    cvFileName:      cvRow.file_name || null,
    attemptCount:    taskCtx.attempt_count,
    maxAttempts:     taskCtx.max_attempts,
    // Backward-compatible aliases used by Build OpenAI Request / Parse AI Response / Build Task Update
    taskAttempt:     taskCtx.attempt_count,
    taskMaxAttempts: taskCtx.max_attempts
  }
}];
`
    },
    output: [{ json: { taskId: 'task-uuid', userId: 'user-uuid', cvId: 'cv-uuid', cvStoragePath: 'user-uuid/file.pdf', cvMimeType: 'application/pdf', cvFileName: 'cv.pdf', attemptCount: 1, maxAttempts: 3, taskAttempt: 1, taskMaxAttempts: 3 } }]
  }
});

// ── 4b-guard. Route errors from Validate CV Context to the failure path ───────
// True (output 0): cvStoragePath is present → continue to Sign Storage URL.
// False (output 1): cvStoragePath is absent (error object) → Handle Context Failure.
// This prevents cascading undefined-path and empty-userId requests when context fails.
const checkContextValid = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Check Context Valid',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'ctx-storage-path-set',
          leftValue: expr('={{ $json.cvStoragePath }}'),
          rightValue: '',
          operator: { type: 'string', operation: 'notEmpty', singleValue: true }
        }],
        combinator: 'and'
      },
      options: {}
    }
  }
});

// ── 4b-err. Write a controlled task failure/retry when context is invalid ──────
// Reads error from $input.item.json.error (set by Validate CV Context with
// continueOnFail) and task metadata from Split Tasks (always ran before this).
// Does NOT reference Sign Storage URL, Download CV Binary, Extract PDF Text,
// Load Preferences, Call OpenAI, or Insert CV Analysis — none have run.
const handleContextFailure = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Handle Context Failure',
    parameters: {
      jsCode: `
// Runs on the false branch of Check Context Valid.
// Validate CV Context returned an error — build the task update without
// referencing intermediate processing nodes that have not yet run.
const splitCtx = $('Split Tasks').item.json;

const rawError = (
  $input.item.json?.error ||
  'CV context validation failed'
).toString();

const isPermanent = rawError.includes('PERMANENT:');
const isRateLimit = rawError.includes('RATE_LIMIT:');
const safeMsg = rawError.replace(/^(PERMANENT:|RATE_LIMIT:|RETRYABLE:)\\s*/, '').substring(0, 500);

const taskId      = splitCtx?.id;
const attempt     = splitCtx?.attempt_count || 0;
const maxAttempts = splitCtx?.max_attempts  || 3;

if (!taskId) {
  return [{ json: { skipped: true, reason: 'No task ID for context failure update.' } }];
}

let patchBody;
if (isPermanent || attempt >= maxAttempts) {
  patchBody = { status: 'failed', failed_at: new Date().toISOString(), last_error: safeMsg };
} else {
  const baseSec   = isRateLimit ? 60 : 30;
  const backoffMs = baseSec * 1000 * Math.pow(2, Math.max(0, attempt - 1));
  patchBody = {
    status:       'pending',
    available_at: new Date(Date.now() + backoffMs).toISOString(),
    last_error:   safeMsg
  };
}

return [{ json: { taskId, patchBody } }];
`
    },
    output: [{ json: { taskId: 'task-uuid', patchBody: { status: 'pending', available_at: '2026-08-13T00:00:00.000Z', last_error: 'CV record not found' } } }]
  }
});

// ── 4c. Generate a 120-second signed download URL ─────────────────────────────
const signStorageUrl = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Sign Storage URL',
    continueOnFail: true,
    parameters: {
      method: 'POST',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/storage/v1/object/sign/cvs/{{ $json.cvStoragePath }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { expiresIn: 120 }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: { signedURL: '/storage/v1/object/sign/cvs/user-uuid/file.pdf?token=sample' } }]
  }
});

// ── 4d. Download the CV binary via the signed URL ─────────────────────────────
const downloadCvBinary = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Download CV Binary',
    continueOnFail: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/storage/v1{{ $json.signedURL }}"),
      sendHeaders: false,
      responseFormat: 'file',
      binaryPropertyName: 'data'
    },
    output: [{ json: {} }]
  }
});

// ── 4e. Extract plain text from the PDF binary ────────────────────────────────
const extractPdfText = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Extract PDF Text',
    continueOnFail: true,
    parameters: {
      operation: 'pdf',
      binaryPropertyName: 'data'
    },
    output: [{ json: { text: 'Sample extracted CV text...' } }]
  }
});

// ── 4f. Load the main job_preferences row (scoped to the claimed task's userId)
const loadPreferences = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load Preferences',
    continueOnFail: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/job_preferences?user_id=eq.{{ $('Validate CV Context').item.json.userId }}&select=id,user_id,work_arrangement,job_market_coverage,job_type,experience_level,additional_notes,custom_target_roles,custom_locations,version&limit=1"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ id: 'pref-uuid', user_id: 'user-uuid', work_arrangement: 'remote', version: 1 }] }]
  }
});

// ── 4g. Load selected target roles from the join table (scoped via job_preference_id
//        derived from the Load Preferences result — itself already scoped to userId)
const loadPreferenceRoles = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load Preference Roles',
    continueOnFail: true,
    alwaysOutputData: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/job_preference_target_roles?job_preference_id=eq.{{ (Array.isArray($('Load Preferences').item.json) ? ($('Load Preferences').item.json[0] || {}) : ($('Load Preferences').item.json || {})).id || '00000000-0000-0000-0000-000000000000' }}&select=target_roles(name)&limit=20"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ target_roles: { name: 'Software Engineer' } }] }]
  }
});

// ── 4h. Load selected locations from the join table (same scope chain as roles) ─
const loadPreferenceLocations = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load Preference Locations',
    continueOnFail: true,
    alwaysOutputData: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/job_preference_locations?job_preference_id=eq.{{ (Array.isArray($('Load Preferences').item.json) ? ($('Load Preferences').item.json[0] || {}) : ($('Load Preferences').item.json || {})).id || '00000000-0000-0000-0000-000000000000' }}&select=locations(name)&limit=20"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: [{ locations: { name: 'Remote' } }] }]
  }
});

// ── 4i. Merge all preference data into a single structured snapshot ────────────
// Combines the main job_preferences row with role names from job_preference_target_roles
// and location names from job_preference_locations. Each fetch is already scoped to
// the claimed task's userId — roles/locations are joined via job_preference_id,
// which was derived from a userId-filtered query. An additional user_id guard
// catches any accidental cross-user reference at the Code layer.
const mergePreferenceData = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge Preference Data',
    continueOnFail: true,
    parameters: {
      jsCode: `
const taskCtx  = $('Validate CV Context').item.json;
const prefsJson = $('Load Preferences').item.json;

// n8n HTTP Request v4.4 unwraps single-element arrays into individual items.
// Accept both a direct object (the common case) and an array.
const prefsRow = Array.isArray(prefsJson)
  ? (prefsJson[0] || null)
  : (prefsJson && typeof prefsJson === 'object' && prefsJson.id ? prefsJson : null);

// Defense-in-depth: the userId that owns this task must match the preferences row.
if (prefsRow && prefsRow.user_id && prefsRow.user_id !== taskCtx.userId) {
  throw new Error('PERMANENT: job_preferences user_id does not match task user_id');
}

// alwaysOutputData on Load Preference Roles guarantees at-least-1 item even when Supabase
// returns []. Empty-sentinel items produce no target_roles.name and are filtered out.
const joinRoleNames = $('Load Preference Roles').all()
  .map(item => item.json?.target_roles?.name)
  .filter(n => typeof n === 'string' && n.length > 0);

// $input.all() collects every location item from the current batch, ensuring
// we capture all rows when Load Preference Locations produces multiple items.
const joinLocNames = $input.all()
  .map(item => item.json?.locations?.name)
  .filter(n => typeof n === 'string' && n.length > 0);

const customRoles = Array.isArray(prefsRow?.custom_target_roles)
  ? prefsRow.custom_target_roles.filter(r => typeof r === 'string' && r.length > 0)
  : [];
const customLocs = Array.isArray(prefsRow?.custom_locations)
  ? prefsRow.custom_locations.filter(l => typeof l === 'string' && l.length > 0)
  : [];

// Combine reference names and custom free-text names — save_job_preferences
// deduplicates custom roles against reference role names already, so there
// is no risk of inserting a role twice.
const allRoles = [...joinRoleNames, ...customRoles];
const allLocs  = [...joinLocNames,  ...customLocs];

return [{
  json: {
    preferenceSnapshot: {
      target_roles:        allRoles.length > 0 ? allRoles : [],
      preferred_locations: allLocs.length  > 0 ? allLocs  : [],
      work_arrangement:    prefsRow?.work_arrangement    || null,
      job_market_coverage: prefsRow?.job_market_coverage || null,
      job_type:            prefsRow?.job_type            || null,
      experience_level:    prefsRow?.experience_level    || null,
      additional_notes:    prefsRow?.additional_notes    || null,
      preferences_version: typeof prefsRow?.version === 'number' ? prefsRow.version : null
    }
  }
}];
`
    },
    output: [{ json: { preferenceSnapshot: { target_roles: ['Software Engineer'], preferred_locations: ['Remote'], work_arrangement: 'remote', job_type: 'full-time', experience_level: 'junior', additional_notes: null, job_market_coverage: null, preferences_version: 1 } } }]
  }
});

// ── 4i-b. Load user feedback for feedback-triggered tasks ─────────────────────
// For tasks with trigger cv_correction, recommendation_feedback, or user_request
// (created by submit_analysis_feedback), this fetches the associated feedback row
// so Build OpenAI Request can include it in the AI prompt. For other triggers
// (onboarding_completed, cv_replaced, preferences_updated) Supabase returns []
// and alwaysOutputData outputs a sentinel item with no feedback_type — the code
// node treats that as "no feedback" and proceeds normally.
const loadTaskFeedback = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load Task Feedback',
    continueOnFail: true,
    alwaysOutputData: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/analysis_feedback?analysis_task_id=eq.{{ $('Validate CV Context').item.json.taskId }}&select=feedback_type,affected_section,feedback_text&limit=1"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: {} }]
  }
});

// ── 4j. Build the GPT-4o request body ─────────────────────────────────────────
// Reads extract output and merged preferences; field names in the JSON schema
// match src/lib/cvAnalysis/types.ts exactly so the Career Profile frontend
// renders all sections without remapping.
const buildOpenAIRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build OpenAI Request',
    continueOnFail: true,
    parameters: {
      jsCode: `
const taskCtx    = $('Validate CV Context').item.json;
const extractOut = $('Extract PDF Text').item.json;
const mergedPrefs = $('Merge Preference Data').item.json;

if (extractOut?.error) {
  throw new Error('RETRYABLE: PDF extraction failed: ' + extractOut.error);
}

// A PERMANENT error from Merge Preference Data (e.g. user_id mismatch) must
// propagate — do not continue with potentially wrong preferences.
if (mergedPrefs?.error && String(mergedPrefs.error).includes('PERMANENT:')) {
  throw new Error(mergedPrefs.error);
}

const cvText = extractOut?.text || '';
if (!cvText.trim()) {
  throw new Error('PERMANENT: PDF produced no extractable text (may be scanned/image-only)');
}

// If preference merge failed for a non-permanent reason, continue with empty
// preferences — CV facts are still extracted correctly and stored.
const preferenceSnapshot = mergedPrefs?.preferenceSnapshot || {
  target_roles: [], preferred_locations: [], work_arrangement: null,
  job_market_coverage: null, job_type: null, experience_level: null,
  additional_notes: null, preferences_version: null
};

// Load Task Feedback: alwaysOutputData means this node always has one item.
// A real feedback row has feedback_type set; the empty sentinel does not.
const feedbackItem = $('Load Task Feedback').item.json;
const feedbackRow = (feedbackItem && feedbackItem.feedback_type) ? feedbackItem : null;

let systemPrompt =
  'You are an expert CV analyst. Extract structured professional information from ' +
  'the CV text and generate a career profile informed by the job preferences.\\n\\n' +
  'Return ONLY a valid JSON object with EXACTLY these fields. No markdown, no explanation.\\n\\n' +
  '{\\n' +
  '  "candidate_name": "Full name as it appears on the CV header or contact section, or null if not found",\\n' +
  '  "candidate_email": "Email address as it appears on the CV, or null if not found",\\n' +
  '  "professional_summary": "2-4 sentence plain-text summary, or null",\\n' +
  '  "skills": ["skill1", "skill2"],\\n' +
  '  "education": [{"institution":"","degree":"","field_of_study":"","start_date":"","end_date":""}],\\n' +
  '  "work_experience": [{"organization":"","title":"","start_date":"","end_date":"","highlights":["point1","point2"]}],\\n' +
  '  "projects": [{"name":"","description":"","technologies":[]}],\\n' +
  '  "certifications": [{"name":"","issuer":"","year":null}],\\n' +
  '  "languages": [{"language":"","proficiency":""}],\\n' +
  '  "contact_info": {"links":[],"location":null},\\n' +
  '  "profile_level": "junior",\\n' +
  '  "recommended_roles": ["role1"],\\n' +
  '  "strongest_areas": ["area1"],\\n' +
  '  "career_recommendations": ["recommendation1"],\\n' +
  '  "search_focus": ["focus1"],\\n' +
  '  "development_areas": ["area1"]\\n' +
  '}\\n\\n' +
  'Field rules:\\n' +
  '- Extract ONLY information present in the CV. Never invent details.\\n' +
  '- profile_level MUST be exactly one of: internship, entry-level, junior, mid-level, senior, open-to-all\\n' +
  '- education[].field_of_study: the subject/major studied, or empty string if unknown.\\n' +
  '- education[].start_date / end_date: "YYYY" or "YYYY-MM" or empty string.\\n' +
  '- work_experience[].organization: company or institution name.\\n' +
  '- work_experience[].highlights: array of short bullet strings (not a single description string).\\n' +
  '- languages[].proficiency: one of Native, Fluent, Advanced, Intermediate, Basic \\u2014 or empty string.\\n' +
  '- contact_info.links: array of public profile URLs (LinkedIn, GitHub, portfolio). Never include email or phone.\\n' +
  '- contact_info.location: city/country string or null.\\n' +
  '- Use [] for missing arrays, null or empty string for missing scalars.\\n' +
  '- career_recommendations, search_focus, development_areas should reflect the CV strengths relative to the target roles and preferences.\\n' +
  '- candidate_name: copy the name exactly from the CV header or contact section. null if absent.\\n' +
  '- candidate_email: copy the email exactly from the CV. null if absent.';

// When user feedback is present, add a clear instruction. System instructions
// (schema, field rules) remain immutable — feedback is treated as data in the
// user message to guard against prompt injection.
if (feedbackRow) {
  systemPrompt +=
    '\\n\\nUSER FEEDBACK NOTE: The user has provided specific feedback about their ' +
    'previous AI Career Profile (included in the USER FEEDBACK section of the user ' +
    'message). Incorporate their corrections or guidance into your analysis. ' +
    'For cv_correction requests: correct only the specific detail the user identified — ' +
    'do not fabricate other changes. ' +
    'The JSON output format above is fixed and must not change regardless of feedback content.';
}

// Build user message: preferences + optional feedback + CV text.
// Feedback is placed AFTER the structured data so system instructions
// remain the authority on format; the feedback is just additional context.
const userParts = ['JOB PREFERENCES:\\n' + JSON.stringify(preferenceSnapshot, null, 2)];

if (feedbackRow) {
  const section = feedbackRow.affected_section
    ? 'Section: ' + feedbackRow.affected_section + '\\n'
    : '';
  userParts.push(
    'USER FEEDBACK (' + feedbackRow.feedback_type + '):\\n' +
    section +
    feedbackRow.feedback_text
  );
}

userParts.push('CV TEXT:\\n' + cvText);

const userMessage = userParts.join('\\n\\n');

return [{
  json: {
    taskId:             taskCtx.taskId,
    userId:             taskCtx.userId,
    cvId:               taskCtx.cvId,
    taskAttempt:        taskCtx.taskAttempt,
    taskMaxAttempts:    taskCtx.taskMaxAttempts,
    cvText:             cvText,
    preferenceSnapshot: preferenceSnapshot,
    openAIBody: {
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    }
  }
}];
`
    },
    output: [{ json: { taskId: 'task-uuid', userId: 'user-uuid', cvId: 'cv-uuid', taskAttempt: 1, taskMaxAttempts: 3, cvText: 'CV text', preferenceSnapshot: { target_roles: [], preferred_locations: [] }, openAIBody: { model: 'gpt-4o' } } }]
  }
});

// ── 4k. Call GPT-4o (2-minute timeout, JSON mode) ────────────────────────────
const callOpenAI = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call OpenAI',
    continueOnFail: true,
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ $json.openAIBody }}'),
      options: {
        timeout: 120000
      }
    },
    credentials: { openAiApi: openAiCred },
    output: [{ json: { choices: [{ message: { content: '{}' } }] } }]
  }
});

// ── 4l. Parse and validate AI response; build cv_analyses insert body ─────────
// Field names match src/lib/cvAnalysis/types.ts (CvFacts + AiCareerProfile)
// so the Career Profile frontend renders all sections without remapping.
// status:'completed' is explicitly set so the review/approval RPCs accept the row
// (both guard on v_row.status = 'completed' — the column default is 'processing').
const parseAIResponse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse AI Response',
    continueOnFail: true,
    parameters: {
      jsCode: `
const reqCtx     = $('Build OpenAI Request').item.json;
const aiResponse = $input.item.json;

if (reqCtx?.error) {
  throw new Error(reqCtx.error);
}
if (aiResponse?.error) {
  throw new Error('RETRYABLE: OpenAI call failed: ' + aiResponse.error);
}

const statusCode = aiResponse?.statusCode || 0;
if (statusCode === 429) {
  throw new Error('RATE_LIMIT: OpenAI rate limit reached');
}
if (statusCode >= 500) {
  throw new Error('RETRYABLE: OpenAI server error ' + statusCode);
}

const rawContent = aiResponse?.choices?.[0]?.message?.content;
if (!rawContent) {
  throw new Error('RETRYABLE: Empty or missing content in OpenAI response');
}

let parsed;
try {
  parsed = JSON.parse(rawContent);
} catch (e) {
  throw new Error('RETRYABLE: Invalid JSON from OpenAI: ' + String(rawContent).substring(0, 120));
}

const allowedLevels = ['internship','entry-level','junior','mid-level','senior','open-to-all'];
if (!allowedLevels.includes(parsed.profile_level)) {
  parsed.profile_level = null;
}

const safeArr = v => Array.isArray(v) ? v : [];
const safeObj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
const safeStr = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;

const prefs = reqCtx.preferenceSnapshot || {};

return [{
  json: {
    taskId:          reqCtx.taskId,
    taskAttempt:     reqCtx.taskAttempt,
    taskMaxAttempts: reqCtx.taskMaxAttempts,
    outcome: 'success',
    candidate_name:  safeStr(parsed.candidate_name),
    candidate_email: safeStr(parsed.candidate_email),
    insertBody: {
      user_id:                reqCtx.userId,
      cv_id:                  reqCtx.cvId,
      analysis_task_id:       reqCtx.taskId,
      // status: 'completed' is required — the column default is 'processing'.
      // Without this, deriveCvProfileState returns "analyzing" indefinitely and
      // update_cv_analysis_review / confirm_cv_analysis both reject the row.
      status:                 'completed',
      ai_provider:            'openai',
      ai_model:               'gpt-4o',
      analyzed_at:            new Date().toISOString(),
      extracted_text:         reqCtx.cvText || null,
      preference_snapshot:    prefs,
      preferences_version:    typeof prefs.preferences_version === 'number' ? prefs.preferences_version : null,
      professional_summary:   safeStr(parsed.professional_summary),
      skills:                 safeArr(parsed.skills),
      education:              safeArr(parsed.education),
      work_experience:        safeArr(parsed.work_experience),
      projects:               safeArr(parsed.projects),
      certifications:         safeArr(parsed.certifications),
      languages:              safeArr(parsed.languages),
      contact_info:           safeObj(parsed.contact_info),
      profile_level:          parsed.profile_level || null,
      recommended_roles:      safeArr(parsed.recommended_roles),
      strongest_areas:        safeArr(parsed.strongest_areas),
      career_recommendations: safeArr(parsed.career_recommendations),
      search_focus:           safeArr(parsed.search_focus),
      development_areas:      safeArr(parsed.development_areas)
    }
  }
}];
`
    },
    output: [{ json: { taskId: 'task-uuid', taskAttempt: 1, taskMaxAttempts: 3, outcome: 'success', insertBody: { status: 'completed' } } }]
  }
});

// ── 4l-b. Load user profile name for CV ownership comparison ──────────────────
const loadUserProfile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load User Profile',
    continueOnFail: true,
    parameters: {
      method: 'GET',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/profiles?id=eq.{{ $('Validate CV Context').item.json.userId }}&select=id,full_name&limit=1"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Accept', value: 'application/json' }
        ]
      }
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: { id: 'user-uuid', full_name: 'Jane Doe' } }]
  }
});

// ── 4l-c. Validate CV ownership via token-based name matching ─────────────────
// Compares the candidate_name extracted from the CV by GPT-4o with the user's
// account full_name. Possible outcomes:
//   name_mismatch  — zero shared tokens, clearly different person → block
//   verified       — Jaccard similarity ≥ 0.4 → allow through
//   unable_to_verify — name missing or 0 < overlap < 0.4 → allow through
// Passes parse output (insertBody, taskId, etc.) unchanged for downstream nodes.
const validateCvOwnership = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate CV Ownership',
    continueOnFail: true,
    parameters: {
      jsCode: `
const parseCtx    = $('Parse AI Response').item.json;
const profileJson = $input.item.json;

const taskId          = parseCtx?.taskId;
const taskAttempt     = parseCtx?.taskAttempt;
const taskMaxAttempts = parseCtx?.taskMaxAttempts;
const candidateName   = parseCtx?.candidate_name || null;

// n8n HTTP Request v4.4 unwraps single-element arrays into individual items.
const profileRow = Array.isArray(profileJson)
  ? (profileJson[0] || null)
  : (profileJson && typeof profileJson === 'object' && profileJson.id ? profileJson : null);

const accountName = profileRow?.full_name || null;

const passthrough = {
  taskId, taskAttempt, taskMaxAttempts,
  outcome:    parseCtx?.outcome,
  insertBody: parseCtx?.insertBody
};

if (!candidateName || !accountName) {
  return [{ json: { ...passthrough, ownershipStatus: 'unable_to_verify', ownershipDetail: null } }];
}

// Normalize: strip diacritics, lowercase, keep only letters, split to tokens > 1 char
function tokenize(name) {
  return name
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, ' ')
    .split(/\\s+/)
    .filter(t => t.length > 1);
}

const tokA = tokenize(accountName);
const tokB = tokenize(candidateName);

if (tokA.length === 0 || tokB.length === 0) {
  return [{ json: { ...passthrough, ownershipStatus: 'unable_to_verify', ownershipDetail: null } }];
}

const setA = new Set(tokA);
const setB = new Set(tokB);
let shared = 0;
for (const t of setA) { if (setB.has(t)) shared++; }
const union = setA.size + setB.size - shared;
const similarity = union === 0 ? 1 : shared / union;

let ownershipStatus, ownershipDetail;
if (shared === 0) {
  ownershipStatus = 'name_mismatch';
  ownershipDetail = 'CV name does not match account name';
} else if (similarity >= 0.4) {
  ownershipStatus = 'verified';
  ownershipDetail = null;
} else {
  ownershipStatus = 'unable_to_verify';
  ownershipDetail = null;
}

return [{ json: { ...passthrough, ownershipStatus, ownershipDetail } }];
`
    },
    output: [{ json: { taskId: 'task-uuid', taskAttempt: 1, taskMaxAttempts: 3, outcome: 'success', insertBody: {}, ownershipStatus: 'verified', ownershipDetail: null } }]
  }
});

// ── 4l-d. Route ownership check ───────────────────────────────────────────────
// True (output 0): ownership is NOT name_mismatch → continue to Insert CV Analysis.
// False (output 1): ownership IS name_mismatch → Handle Ownership Mismatch.
const checkOwnershipValid = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'Check Ownership Valid',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'ownership-not-mismatch',
          leftValue: expr('={{ $json.ownershipStatus }}'),
          rightValue: 'name_mismatch',
          operator: { type: 'string', operation: 'notEquals' }
        }],
        combinator: 'and'
      },
      options: {}
    }
  }
});

// ── 4l-e. Build permanent task failure for ownership mismatch ─────────────────
// Runs on the FALSE branch of Check Ownership Valid. Writes last_error with the
// "OWNERSHIP_MISMATCH:" prefix so the frontend shows a targeted recovery UI
// ("Upload another CV" / "Update account name") instead of a generic error.
const handleOwnershipMismatch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Handle Ownership Mismatch',
    parameters: {
      jsCode: `
const ownershipCtx = $('Validate CV Ownership').item.json;
const splitCtx     = $('Split Tasks').item.json;

const taskId = ownershipCtx?.taskId || splitCtx?.id;
const detail = ownershipCtx?.ownershipDetail || 'CV name does not match account name';

return [{
  json: {
    taskId,
    patchBody: {
      status:     'failed',
      failed_at:  new Date().toISOString(),
      last_error: 'OWNERSHIP_MISMATCH: ' + detail.substring(0, 400)
    }
  }
}];
`
    },
    output: [{ json: { taskId: 'task-uuid', patchBody: { status: 'failed', last_error: 'OWNERSHIP_MISMATCH: CV name does not match account name' } } }]
  }
});

// ── 4m. Insert the cv_analyses row (idempotent: conflict = skip, not error) ───
// Prefer: resolution=ignore-duplicates means a duplicate on analysis_task_id_key
// is silently skipped (no error). Build Task Update treats this as success:
// the row was already inserted by an earlier attempt for the same task, and
// the task should now complete. No approved/current row is at risk — see the
// DUPLICATE-INSERT SAFETY header comment.
const insertCvAnalysis = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Insert CV Analysis',
    continueOnFail: true,
    parameters: {
      method: 'POST',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/cv_analyses"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Prefer', value: 'resolution=ignore-duplicates,return=minimal' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ $json.insertBody }}')
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: {} }]
  }
});

// ── 4n. Resolve success / retry / permanent-fail outcome ──────────────────────
const buildTaskUpdate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Task Update',
    parameters: {
      jsCode: `
const parseResult  = $('Parse AI Response').item.json;
const insertResult = $input.item.json;
const validateCtx  = $('Validate CV Context').item.json;
const splitCtx     = $('Split Tasks').item.json;

// Fallback chain: later nodes may have replaced the item with an error object.
const taskId      = parseResult?.taskId      || validateCtx?.taskId      || splitCtx?.id;
const attempt     = parseResult?.taskAttempt || validateCtx?.taskAttempt || splitCtx?.attempt_count || 0;
const maxAttempts = parseResult?.taskMaxAttempts || validateCtx?.taskMaxAttempts || splitCtx?.max_attempts || 3;

if (!taskId) {
  // No task ID resolved anywhere in the chain. The stale-task sweep will catch
  // this task once its 10-minute lease expires on the next execution.
  return [{ json: { skipped: true, reason: 'No task ID resolved.' } }];
}

const parseSucceeded = parseResult?.outcome === 'success';
const insertError    = insertResult?.error;

let patchBody;

if (parseSucceeded && !insertError) {
  // Success path. Also covers the idempotent-retry case where the INSERT was
  // silently ignored because analysis_task_id already existed: the existing row
  // is already status='completed', the task should complete, no approved/current
  // row is touched (see DUPLICATE-INSERT SAFETY in the file header).
  patchBody = { status: 'completed', completed_at: new Date().toISOString() };
} else {
  // Walk the error chain to find the first informative message.
  const rawError = (
    insertError ||
    parseResult?.error ||
    $('Call OpenAI').item.json?.error ||
    $('Build OpenAI Request').item.json?.error ||
    $('Validate CV Ownership').item.json?.error ||
    $('Load User Profile').item.json?.error ||
    $('Merge Preference Data').item.json?.error ||
    $('Load Preference Locations').item.json?.error ||
    $('Load Preference Roles').item.json?.error ||
    $('Load Preferences').item.json?.error ||
    $('Extract PDF Text').item.json?.error ||
    $('Download CV Binary').item.json?.error ||
    $('Sign Storage URL').item.json?.error ||
    validateCtx?.error ||
    $('Load CV Row').item.json?.error ||
    'Unknown processing error'
  )?.toString() || 'Unknown processing error';

  const isPermanent = rawError.includes('PERMANENT:');
  const isRateLimit = rawError.includes('RATE_LIMIT:');
  // Strip prefix before writing to last_error — never log raw internal error detail
  const safeMsg = rawError.replace(/^(PERMANENT:|RATE_LIMIT:|RETRYABLE:)\\s*/, '').substring(0, 500);

  if (isPermanent || attempt >= maxAttempts) {
    patchBody = { status: 'failed', failed_at: new Date().toISOString(), last_error: safeMsg };
  } else {
    // Exponential backoff: base × 2^(attempt-1). Rate-limit base is 60s.
    const baseSec   = isRateLimit ? 60 : 30;
    const backoffMs = baseSec * 1000 * Math.pow(2, Math.max(0, attempt - 1));
    patchBody = {
      status:       'pending',
      available_at: new Date(Date.now() + backoffMs).toISOString(),
      last_error:   safeMsg
    };
  }
}

return [{ json: { taskId, patchBody } }];
`
    },
    output: [{ json: { taskId: 'task-uuid', patchBody: { status: 'completed', completed_at: '2026-08-11T00:00:00.000Z' } } }]
  }
});

// ── 4o. Write the final task status ───────────────────────────────────────────
const updateTaskStatus = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Update Task Status',
    parameters: {
      method: 'PATCH',
      url: expr("={{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/analysis_tasks?id=eq.{{ $json.taskId }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Prefer', value: 'return=minimal' }
        ]
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('={{ $json.patchBody }}')
    },
    credentials: { supabaseApi: supabaseCred },
    output: [{ json: {} }]
  }
});

// NOTE: checkContextValid is an IF node with two outputs.
// The SDK .to() chain represents the TRUE (success) branch only.
// The FALSE (error) branch connection — checkContextValid[1] → handleContextFailure[0] →
// updateTaskStatus[0] — is defined in cv-analysis-worker.json and applied to the live
// workflow via the n8n MCP update_workflow tool.
export default workflow('cv-analysis-worker', 'CV Analysis Worker')
  .add(pollTrigger)
  .to(workflowConfig)
  .to(failStuckTasks)
  .to(claimBatch)
  .to(splitTasks)
  .to(batchLoop
    .onEachBatch(
      loadCvRow
        .to(validateCvContext)
        .to(checkContextValid)   // TRUE → signStorageUrl; FALSE → handleContextFailure
        .to(signStorageUrl)      // connected from checkContextValid output[0]
        .to(downloadCvBinary)
        .to(extractPdfText)
        .to(loadPreferences)
        .to(loadPreferenceRoles)
        .to(loadPreferenceLocations)
        .to(mergePreferenceData)
        .to(loadTaskFeedback)
        .to(buildOpenAIRequest)
        .to(callOpenAI)
        .to(parseAIResponse)
        .to(loadUserProfile)
        .to(validateCvOwnership)
        .to(checkOwnershipValid)     // TRUE → insertCvAnalysis; FALSE → handleOwnershipMismatch
        .to(insertCvAnalysis)        // connected from checkOwnershipValid output[0]
        .to(buildTaskUpdate)
        .to(updateTaskStatus)        // also receives from handleContextFailure, handleOwnershipMismatch
        .to(nextBatch(batchLoop))
    )
  );
// FALSE branches (declared separately — SDK cannot express multi-output in .to() chain):
// checkContextValid[1]   → handleContextFailure   → updateTaskStatus
// checkOwnershipValid[1] → handleOwnershipMismatch → updateTaskStatus
