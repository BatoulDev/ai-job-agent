import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, newCredential, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Job Matching Run' },
});

const workflowConfiguration = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Workflow Configuration',
    parameters: {
      mode: 'raw',
      jsonOutput:
        '{"appBaseUrl":"http://host.docker.internal:3000","jobLimit":50,"profileLimit":50,"embeddingModel":"text-embedding-3-small",' +
        '"userLimit":20,"jobsPerUser":10,"candidatePoolSize":100,"rerankModel":"gpt-4o-mini"}',
    },
  },
  output: [
    {
      appBaseUrl: 'http://host.docker.internal:3000',
      jobLimit: 50,
      profileLimit: 50,
      embeddingModel: 'text-embedding-3-small',
      userLimit: 20,
      jobsPerUser: 10,
      candidatePoolSize: 100,
      rerankModel: 'gpt-4o-mini',
    },
  ],
});

const prepareEmbeddings = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Prepare Embeddings',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $json.appBaseUrl }}/api/internal/matching/prepare-embeddings"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { jobLimit: $json.jobLimit, profileLimit: $json.profileLimit } }}'),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Matching Worker Secret') },
  },
  output: [{ jobs: [{ jobId: 'job-1', text: 'Title: Backend Engineer', contentHash: 'abc' }], profiles: [] }],
});

const buildEmbeddingsRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Embeddings Request',
    parameters: {
      mode: 'raw',
      jsonOutput: expr(
        '{{ (() => {\n' +
          '  const jobs = $json.jobs || [];\n' +
          '  const profiles = $json.profiles || [];\n' +
          '  const input = [...jobs.map(j => j.text), ...profiles.map(p => p.text)];\n' +
          "  return { input, jobs, profiles, itemCount: input.length, model: $('Workflow Configuration').first().json.embeddingModel };\n" +
          '})() }}'
      ),
    },
  },
  output: [{ input: ['Title: Backend Engineer'], jobs: [{ jobId: 'job-1', contentHash: 'abc' }], profiles: [], itemCount: 1, model: 'text-embedding-3-small' }],
});

const hasAnythingToEmbed = ifElse({
  version: 2.3,
  config: {
    name: 'Has Anything To Embed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.itemCount }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 }],
        combinator: 'and',
      },
    },
  },
  output: [{ input: ['Title: Backend Engineer'], itemCount: 1 }],
});

const generateEmbeddings = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Generate Embeddings',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/embeddings',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { model: $json.model, input: $json.input } }}'),
      options: { timeout: 60000 },
    },
    credentials: { openAiApi: newCredential('OpenAI account') },
  },
  output: [{ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }], model: 'text-embedding-3-small', usage: { total_tokens: 10 } }],
});

const buildSaveEmbeddingsRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Save Embeddings Request',
    parameters: {
      mode: 'raw',
      jsonOutput: expr(
        '{{ (() => {\n' +
          "  const jobs = $('Build Embeddings Request').item.json.jobs;\n" +
          "  const profiles = $('Build Embeddings Request').item.json.profiles;\n" +
          '  const vectors = [];\n' +
          '  for (const d of $json.data) vectors[d.index] = d.embedding;\n' +
          '  const jobPayload = jobs.map((j, i) => ({ jobId: j.jobId, embedding: vectors[i], contentHash: j.contentHash }));\n' +
          '  const profilePayload = profiles.map((p, i) => ({ cvAnalysisId: p.cvAnalysisId, embedding: vectors[jobs.length + i], contentHash: p.contentHash }));\n' +
          '  return { jobs: jobPayload, profiles: profilePayload };\n' +
          '})() }}'
      ),
    },
  },
  output: [{ jobs: [{ jobId: 'job-1', embedding: [0.1, 0.2, 0.3], contentHash: 'abc' }], profiles: [] }],
});

const saveEmbeddings = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Save Embeddings',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/matching/save-embeddings"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { jobs: $json.jobs, profiles: $json.profiles } }}'),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Matching Worker Secret') },
  },
  output: [{ jobsSaved: 1, profilesSaved: 0, profilesSkipped: 0 }],
});

const logEmbeddingsFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log Embeddings Failure',
    notes: 'Terminal failure node for this manually-triggered maintenance run — a human reviews the n8n execution log directly (no per-source loop/summary needed here, unlike Job Ingestion).',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'embeddings step failed' }}"), type: 'string' }] },
    },
  },
  output: [{ error: 'request failed' }],
});

const nothingToEmbed = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Nothing To Embed',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'message', name: 'message', value: 'No jobs or profiles currently need embedding.', type: 'string' }] },
    },
  },
  output: [{ message: 'No jobs or profiles currently need embedding.' }],
});

// ── Rerank stage (Phase 06) ─────────────────────────────────────────────
// Runs regardless of the embedding stage's outcome — it reranks whatever is
// ALREADY embedded (from this run or a prior one), not only what this run
// just embedded. Unlike embeddings, OpenAI's chat completions API has no
// batch endpoint, so this loops one candidate at a time (matching Job
// Ingestion's per-source rate-limited loop pattern) and saves each result
// immediately rather than trying to aggregate all results into one final
// call — the same cross-loop-aggregation pitfall the embedding step's now-
// removed "Build Execution Summary" node hit is avoided entirely by never
// attempting it here.

const prepareRerank = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Prepare Rerank',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/matching/prepare-rerank"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        "{{ { userLimit: $('Workflow Configuration').first().json.userLimit, jobsPerUser: $('Workflow Configuration').first().json.jobsPerUser, candidatePoolSize: $('Workflow Configuration').first().json.candidatePoolSize } }}"
      ),
      options: { timeout: 60000 },
    },
    credentials: { httpBearerAuth: newCredential('Matching Worker Secret') },
  },
  output: [{ candidates: [{ candidateId: 'analysis-1:job-1', prompt: 'Assess this candidate.' }] }],
});

const splitOutCandidates = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Candidates',
    parameters: { fieldToSplitOut: 'candidates' },
  },
  output: [{ candidateId: 'analysis-1:job-1', prompt: 'Assess this candidate.' }],
});

const loopCandidates = splitInBatches({
  version: 3,
  config: { name: 'Loop Candidates (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ candidateId: 'analysis-1:job-1', prompt: 'Assess this candidate.' }],
});

const buildChatRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Chat Request',
    parameters: {
      mode: 'raw',
      jsonOutput: expr(
        "{{ { model: $('Workflow Configuration').first().json.rerankModel, temperature: 0, max_tokens: 600, response_format: { type: 'json_object' }, messages: [ { role: 'user', content: $json.prompt } ] } }}"
      ),
    },
  },
  output: [{ model: 'gpt-4o-mini', temperature: 0, max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: 'Assess this candidate.' }] }],
});

const callOpenAIChat = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call OpenAI Chat',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json }}'),
      options: { timeout: 60000 },
    },
    credentials: { openAiApi: newCredential('OpenAI account') },
  },
  output: [{ choices: [{ message: { content: '{"score":80,"reason":"Good fit.","strengths":["TypeScript"],"missing_skills":[],"preference_alignment":"Matches."}' } }] }],
});

const buildSaveRerankRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Save Rerank Request',
    parameters: {
      mode: 'raw',
      jsonOutput: expr(
        "{{ { matchingModel: $('Workflow Configuration').first().json.rerankModel, results: [ { candidateId: $('Split Out Candidates').item.json.candidateId, response: $json.choices[0].message.content } ] } }}"
      ),
    },
  },
  output: [{ matchingModel: 'gpt-4o-mini', results: [{ candidateId: 'analysis-1:job-1', response: '{"score":80}' }] }],
});

const saveRerankResult = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Save Rerank Result',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/matching/save-rerank-results"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json }}'),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Matching Worker Secret') },
  },
  output: [{ saved: 1, invalid_candidate_id: 0, invalid_response: 0, not_matching_eligible: 0, save_failed: 0 }],
});

const logRerankFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log Rerank Failure',
    notes:
      'Terminal failure node for one rerank candidate — a human reviews the n8n execution log; the loop still proceeds to the next candidate after this (see the Wait node it feeds into).',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'rerank step failed' }}"), type: 'string' }] },
    },
  },
  output: [{ error: 'request failed' }],
});

const rerankRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Rerank Rate Limit Delay',
    parameters: { resume: 'timeInterval', amount: 1, unit: 'seconds' },
  },
  output: [{ candidateId: 'analysis-1:job-1' }],
});

const overviewNote = sticky(
  '### AI Job Guide / 02 Job Matching\n' +
    'Manual trigger, stays inactive. Two stages, both delegating validation/dedup/persistence to internal TypeScript ' +
    'endpoints and only ever having n8n own the actual AI provider call, reusing the existing "OpenAI account" ' +
    'credential (same one cv-analysis-worker.ts already uses):\n\n' +
    '1. Embeddings — batches every pending job+profile into a single OpenAI /v1/embeddings request per run.\n' +
    '2. Rerank — loops one (profile, job) candidate at a time (chat completions has no batch endpoint), scores it, ' +
    'and saves immediately, rather than aggregating all results into one final call — the cross-loop-aggregation ' +
    'pitfall the embedding stage\'s now-removed "Build Execution Summary" node hit is avoided entirely this way.\n\n' +
    'The rerank stage runs regardless of the embedding stage\'s outcome (success, nothing-to-embed, or failure) — it ' +
    'reranks whatever is already embedded, not only what this run just embedded.',
  [startTrigger, workflowConfiguration],
  { color: 4 }
);

export default workflow('ai-job-agent-02-job-matching', 'AI Job Guide / 02 Job Matching')
  .add(startTrigger)
  .to(workflowConfiguration)
  .to(prepareEmbeddings.onError(logEmbeddingsFailure))
  .to(buildEmbeddingsRequest)
  .to(
    hasAnythingToEmbed
      .onTrue(
        generateEmbeddings
          .onError(logEmbeddingsFailure)
          .to(buildSaveEmbeddingsRequest)
          .to(saveEmbeddings.onError(logEmbeddingsFailure).to(prepareRerank))
      )
      .onFalse(nothingToEmbed.to(prepareRerank))
  )
  .add(logEmbeddingsFailure.to(prepareRerank))
  .add(
    prepareRerank
      .onError(logRerankFailure)
      .to(
        splitOutCandidates.to(
          loopCandidates.onEachBatch(
            buildChatRequest
              .to(callOpenAIChat)
              .onError(logRerankFailure)
              .to(buildSaveRerankRequest)
              .to(saveRerankResult.onError(logRerankFailure).to(rerankRateLimitDelay))
          )
        )
      )
  )
  .add(logRerankFailure.to(rerankRateLimitDelay))
  .add(rerankRateLimitDelay.to(nextBatch(loopCandidates)))
  .add(overviewNote);
