import { workflow, node, trigger, sticky, splitInBatches, nextBatch, newCredential, expr } from "@n8n/workflow-sdk";

// AI Job Agent / 03 Cover Letter Generation (Phase 08). Manual trigger,
// stays inactive. Same architecture as Phase 05/06's "AI Job Agent / 02 Job
// Matching": TypeScript (via internal endpoints) owns discovery/validation/
// persistence; n8n owns the actual OpenAI call, reusing the existing
// "OpenAI account" credential. POST /api/internal/cover-letters/prepare-generation
// discovers which approved matches still need a cover-letter draft and
// builds each one's exact grounded prompt; this workflow calls OpenAI chat
// completions once per candidate (no batch endpoint exists for chat, same
// as Phase 06's rerank stage) and POSTs each result to
// /api/internal/cover-letters/save-generation, which re-validates the
// response and re-checks the match is still approved before writing.

const startTrigger = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: { name: "Start Cover Letter Generation Run" },
});

const workflowConfig = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Workflow Configuration",
    parameters: {
      mode: "raw",
      jsonOutput: '{"appBaseUrl":"http://host.docker.internal:3000","limit":50,"model":"gpt-4o-mini"}',
    },
  },
});

const logPrepareFailure = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Log Prepare Failure",
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          { id: "error", name: "error", value: expr("{{ $json.error?.message ?? 'prepare-generation step failed' }}"), type: "string" },
        ],
      },
    },
    notes: "Terminal failure node for this manually-triggered maintenance run — a human reviews the n8n execution log directly.",
  },
});

const prepareGeneration = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Prepare Generation",
    parameters: {
      method: "POST",
      url: expr("{{ $json.appBaseUrl }}/api/internal/cover-letters/prepare-generation"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ { limit: $json.limit } }}"),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential("Cover Letter Worker Secret") },
    onError: "continueErrorOutput",
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
  },
});

const splitOutCandidates = node({
  type: "n8n-nodes-base.splitOut",
  version: 1,
  config: {
    name: "Split Out Candidates",
    parameters: { fieldToSplitOut: "candidates" },
  },
});

const loopCandidates = splitInBatches({
  version: 3,
  config: { name: "Loop Candidates (Rate Limited)", parameters: { batchSize: 1 } },
});

const buildChatRequest = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Build Chat Request",
    parameters: {
      mode: "raw",
      jsonOutput: expr(
        "{{ { model: $('Workflow Configuration').first().json.model, temperature: 0.7, max_tokens: 700, messages: [ { role: 'user', content: $json.prompt } ] } }}"
      ),
    },
  },
});

const logGenerationFailure = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Log Generation Failure",
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          { id: "error", name: "error", value: expr("{{ $json.error?.message ?? 'cover letter generation step failed' }}"), type: "string" },
        ],
      },
    },
    notes: "Terminal failure node for one candidate — a human reviews the n8n execution log; the loop still proceeds to the next candidate after this (see the Wait node it feeds into).",
  },
});

const callOpenAiChat = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Call OpenAI Chat",
    parameters: {
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "openAiApi",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ $json }}"),
      options: { timeout: 60000 },
    },
    onError: "continueErrorOutput",
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
  },
});

const buildSaveRequest = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Build Save Request",
    parameters: {
      mode: "raw",
      jsonOutput: expr(
        "{{ { modelProvider: 'openai', modelVersion: $('Workflow Configuration').first().json.model, results: [ { matchId: $('Split Out Candidates').item.json.matchId, response: $json.choices[0].message.content } ] } }}"
      ),
    },
  },
});

const saveGenerationResult = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Save Generation Result",
    parameters: {
      method: "POST",
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/cover-letters/save-generation"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ $json }}"),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential("Cover Letter Worker Secret") },
    onError: "continueErrorOutput",
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
  },
});

const rateLimitDelay = node({
  type: "n8n-nodes-base.wait",
  version: 1.1,
  config: {
    name: "Generation Rate Limit Delay",
    parameters: { resume: "timeInterval", amount: 1, unit: "seconds" },
  },
});

logGenerationFailure.to(rateLimitDelay);

const introNote = sticky(
  "### AI Job Agent / 03 Cover Letter Generation\nManual trigger, stays inactive. POST /api/internal/cover-letters/prepare-generation (TypeScript, Phase 08) decides which approved matches still need a draft and builds the exact grounded prompt; this workflow calls OpenAI chat completions once per candidate (reusing the existing \"OpenAI account\" credential, same one cv-analysis-worker.ts and Phase 06's rerank stage already use) since chat completions has no batch endpoint; POST /api/internal/cover-letters/save-generation persists the result and re-checks the match is still approved before writing. A failed attempt is never recorded — the match is simply re-offered as a candidate on the next run, same retry story as Phase 06's rerank.",
  [startTrigger, workflowConfig, prepareGeneration],
  { color: 4, width: 320, height: 220 }
);

export default workflow("ai-job-agent-03-cover-letter-generation", "AI Job Agent / 03 Cover Letter Generation")
  .add(startTrigger)
  .to(workflowConfig)
  .to(
    prepareGeneration
      .onError(logPrepareFailure)
      .to(splitOutCandidates)
      .to(
        loopCandidates.onEachBatch(
          buildChatRequest
            .to(callOpenAiChat.onError(logGenerationFailure))
            .to(buildSaveRequest)
            .to(saveGenerationResult.onError(logGenerationFailure))
            .to(rateLimitDelay)
            .to(nextBatch(loopCandidates))
        )
      )
  )
  .add(introNote);
