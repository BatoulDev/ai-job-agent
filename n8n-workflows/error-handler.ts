/**
 * AI Job Agent — Error Handler — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * Import the companion JSON file via n8n UI → (hamburger menu) → Import
 * from File → error-handler.json, or via n8n MCP create_workflow_from_code
 * / update_workflow using this source.
 *
 * PURPOSE
 * ───────
 * A single, reusable execution-level failure handler for every scheduled/
 * unattended AI Job Agent n8n workflow (Source Intelligence Analyzer today;
 * Registry Sync, Job Ingestion, and any future scheduled workflow can
 * attach to this SAME workflow later — nothing here is Source-Intelligence-
 * specific). Handles exactly one failure class: "an execution started, then
 * genuinely failed" (a crashed node — bad credential, unreachable Supabase,
 * a real bug). It does NOT and CANNOT detect "the schedule never fired at
 * all" — no execution exists for an Error Trigger to catch in that case;
 * that is a separate, deliberately out-of-scope problem (missed-run/
 * heartbeat monitoring), to be solved only once this project moves to an
 * always-on host.
 *
 * HOW A WORKFLOW ATTACHES TO THIS HANDLER — MANUAL STEP REQUIRED
 * ─────────────────────────────────────────────────────────────────
 * n8n's "Error Workflow" attachment is a per-workflow SETTING (Settings →
 * Error Workflow, in the workflow's own three-dot menu), not a node and
 * not a parameter — confirmed empirically this session that the n8n
 * Workflow SDK has no method to set it (`workflow(...).settings(...)` is
 * rejected outright: "'settings' is not an allowed SDK method"), and
 * n8n-mcp's update_workflow operation list has no workflow-level-settings
 * operation either (only setNodeSettings, which is node-level: onError/
 * retryOnFail/etc). This is the exact same confirmed gap already
 * documented in source-intelligence-analyzer.ts for the `timezone`
 * setting. There is therefore no way to represent or apply this
 * attachment from the repo or via MCP tooling — it must be set once, by
 * hand, in the n8n UI, for every workflow that should use this handler:
 * open the workflow → Settings (three-dot menu, top right) → Error
 * Workflow → select "AI Job Agent - Error Handler". This file's own
 * existence and this comment ARE the repo's representation of that
 * intent — the setting itself lives only in n8n's own workflow metadata.
 *
 * Do NOT set this workflow's own Error Workflow to itself — an error
 * inside this handler must not attempt to re-trigger itself.
 *
 * ERROR TRIGGER PAYLOAD — SOURCED FROM N8N'S OWN OFFICIAL DOCS, NOT GUESSED
 * ───────────────────────────────────────────────────────────────────────
 * A live empirical test (deliberately fail a disposable workflow with this
 * handler attached, inspect the real execution) was the first choice, but
 * is blocked this session: n8n's per-workflow "Error Workflow" setting
 * cannot be set via the n8n Workflow SDK (`workflow(...).settings(...)` is
 * rejected outright — "'settings' is not an allowed SDK method") or via
 * n8n-mcp's update_workflow (its operation list has no workflow-level-
 * settings operation, only node-level setNodeSettings) — the same gap
 * already documented in source-intelligence-analyzer.ts for `timezone`.
 * Instead, the exact shape below is copied from n8n's own official docs
 * (docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger,
 * fetched 2026-09-24), not from memory or assumption:
 *   { execution: { id, url, retryOf, error: { message, stack },
 *     lastNodeExecuted, mode }, workflow: { id, name } }
 * Documented field-availability notes, applied directly below: execution.
 * id/url are absent when the error occurs in a TRIGGER node itself (rare
 * for this project's triggers — Manual/Schedule Trigger call nothing
 * external); execution.retryOf only appears on a retried execution;
 * execution.error has ONLY message + stack (no .name, no .node — an
 * earlier draft this session incorrectly assumed both; corrected here).
 * lastNodeExecuted (a plain node-name string) is the documented, always-
 * present way to know which node failed — not execution.error.node,
 * which does not exist in this shape. A trigger-node-level error instead
 * populates a differently-shaped trigger{} object (error.context/name/
 * cause/timestamp/node) — handled as a defensive fallback below, since
 * this project's own triggers make it very unlikely but the docs call it
 * out explicitly. If you want to empirically confirm this shape yourself,
 * it's one manual step: open a disposable test workflow → Settings →
 * Error Workflow → this workflow, execute a deliberate failure, inspect
 * the resulting execution here.
 *
 * NOTIFICATION BOUNDARY — DELIBERATELY STOPS HERE
 * ─────────────────────────────────────────────────
 * No notification channel is wired yet. This project has no established,
 * clearly-AI-Job-Agent-owned notification credential today (checked: no
 * Slack/email/webhook config in .env*, no operator-notification code or
 * docs in the repo; the existing `notifications` table is strictly an
 * end-user in-app/email feature, unrelated to ops alerting; an ambient
 * "Telegram account 2" n8n credential exists in this account but its
 * ownership/intent for THIS project was not established, so it is not
 * treated as safe to wire up unasked). Notification Boundary is a plain
 * No-Op marking exactly where a real channel node (Telegram/Slack/Email/
 * generic webhook) gets added once a channel is chosen and its credential
 * configured — see this session's report for the exact options and what
 * you need to provide.
 *
 * DUPLICATE-ALERT SAFETY
 * ────────────────────────
 * n8n invokes a workflow's Error Workflow at most once per failed
 * execution (n8n's own semantics, not something built here), and this
 * pipeline is a single linear chain with no branching or looping after
 * the trigger — nothing in this workflow can itself cause more than one
 * notification per failure. No additional de-duplication logic was added;
 * none is needed for "one failed execution → one alert" at this scale.
 */

import { workflow, node, trigger, sticky, expr } from '@n8n/workflow-sdk';

const errorTrigger = trigger({
  type: 'n8n-nodes-base.errorTrigger',
  version: 1,
  config: { name: 'Error Trigger', position: [-200, 0] },
  output: [
    {
      execution: {
        id: 'exec-example',
        url: 'http://localhost:5678/workflow/abc123/executions/exec-example',
        error: { message: 'Example error message', stack: 'Error: Example error message\n    at ...' },
        lastNodeExecuted: 'Load Candidate Sources',
        mode: 'trigger',
      },
      workflow: { id: 'abc123', name: 'AI Job Agent - Source Intelligence Analyzer' },
    },
  ],
});

// Extracts a small, stable internal shape from n8n's own documented Error
// Trigger payload (see this file's own header for the exact source and
// field-availability notes) — every field read with optional chaining and
// a safe fallback, since several are documented as not always present
// (execution.id/url absent for a trigger-node error; execution.retryOf
// only on a retry). Falls back to the differently-shaped trigger{} object
// for the rarer trigger-node-error case. Never reads/forwards the error's
// own `stack` — that diagnostic detail stays in n8n's own execution
// history, one click away via executionUrl.
const normalizeErrorEvent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Error Event',
    position: [100, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const r = $input.first().json;\n" +
        "const exec = r.execution ?? null;\n" +
        "const trig = r.trigger ?? null;\n" +
        "\n" +
        "const workflowName = r.workflow?.name ?? 'unknown workflow';\n" +
        "const workflowId = r.workflow?.id ?? null;\n" +
        "const executionId = exec?.id ?? null;\n" +
        "const executionUrl = exec?.url ?? null;\n" +
        "const executionMode = exec?.mode ?? trig?.mode ?? null;\n" +
        "const retryOf = exec?.retryOf ?? null;\n" +
        "// lastNodeExecuted (a plain node-name string) is n8n's documented,\n" +
        "// always-present way to know which node failed for a normal\n" +
        "// (non-trigger-node) error — execution.error has no .node field.\n" +
        "const failedNodeName = exec?.lastNodeExecuted ?? trig?.error?.node ?? null;\n" +
        "const errorMessage = exec?.error?.message\n" +
        "  ?? trig?.error?.cause?.message\n" +
        "  ?? trig?.error?.context?.message\n" +
        "  ?? trig?.error?.name\n" +
        "  ?? 'No error message provided by n8n';\n" +
        "const timestamp = new Date().toISOString();\n" +
        "\n" +
        "return [{ json: {\n" +
        "  workflowName,\n" +
        "  workflowId,\n" +
        "  executionId,\n" +
        "  executionUrl,\n" +
        "  executionMode,\n" +
        "  retryOf,\n" +
        "  failedNodeName,\n" +
        "  errorMessage,\n" +
        "  timestamp,\n" +
        "} }];",
    },
  },
  output: [
    {
      workflowName: 'AI Job Agent - Source Intelligence Analyzer',
      workflowId: 'abc123',
      executionId: 'exec-example',
      executionUrl: 'http://localhost:5678/workflow/abc123/executions/exec-example',
      executionMode: 'trigger',
      retryOf: null,
      failedNodeName: 'Load Candidate Sources',
      errorMessage: 'Example error message',
      timestamp: '2026-09-24T00:00:00.000Z',
    },
  ],
});

// Builds the exact operator-facing message text — concise, actionable,
// never a stack trace or request/response payload. The full diagnostic
// detail always remains one click away via executionUrl, inside n8n's
// own execution history.
const buildAlertMessage = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Alert Message',
    position: [400, 0],
    parameters: {
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'alert-text-field',
            name: 'alertText',
            type: 'string',
            value: expr(
              "={{ 'AI Job Agent — Workflow Failure\\n\\n' + 'Workflow: ' + $json.workflowName + '\\n' + 'Time: ' + $json.timestamp + '\\n' + 'Execution: ' + ($json.executionUrl || $json.executionId || 'unknown') + '\\n' + 'Failed node: ' + ($json.failedNodeName || 'unknown') + '\\n' + 'Error: ' + $json.errorMessage }}"
            ),
          },
        ],
      },
    },
  },
  output: [{ alertText: 'AI Job Agent — Workflow Failure\n\nWorkflow: AI Job Agent - Source Intelligence Analyzer\nTime: 2026-09-24T00:00:00.000Z\nExecution: http://localhost:5678/workflow/abc123/executions/exec-example\nFailed node: Load Candidate Sources\nError: Example error message' }],
});

// Deliberately a No-Op, not a real notification node yet — see this
// file's own header ("NOTIFICATION BOUNDARY") for exactly why, and this
// session's report for the channel options and what is needed to wire a
// real one in.
const notificationBoundary = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Notification Boundary', position: [700, 0] },
  output: [{}],
});

const overviewNote = sticky(
  '### AI Job Agent — Error Handler\n' +
    'Reusable execution-level failure handler — attach any AI Job Agent scheduled/unattended workflow to this ' +
    'one via its own Settings → Error Workflow (a manual, per-workflow n8n UI step; the SDK/MCP cannot set it — ' +
    'see this file\'s own header). Fires once per genuinely FAILED execution (a crashed node), never for expected ' +
    'per-source data outcomes (429/403/5xx/no-URL/etc. are handled as data inside the source workflows ' +
    'themselves and never reach here). Does NOT detect a schedule that never fired at all — no execution exists ' +
    'for this trigger to catch in that case; that is a separate, later, always-on-hosting-phase concern. ' +
    'Normalize Error Event → Build Alert Message → Notification Boundary (a placeholder — no channel wired yet, ' +
    'pending an explicit, approved credential).',
  [errorTrigger],
  { color: 3 }
);

export default workflow('error-handler', 'AI Job Agent - Error Handler')
  .add(errorTrigger)
  .to(normalizeErrorEvent.to(buildAlertMessage.to(notificationBoundary)))
  .add(overviewNote);
