import { workflow, node, trigger, sticky, ifElse, newCredential, expr } from '@n8n/workflow-sdk';

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
      jsonOutput: '{"appBaseUrl":"http://host.docker.internal:3000","jobLimit":50,"profileLimit":50,"embeddingModel":"text-embedding-3-small"}',
    },
  },
  output: [{ appBaseUrl: 'http://host.docker.internal:3000', jobLimit: 50, profileLimit: 50, embeddingModel: 'text-embedding-3-small' }],
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

const overviewNote = sticky(
  '### AI Job Agent / 02 Job Matching — embedding step\n' +
    'Manual trigger, stays inactive. Splits the "embed things" concern from the "call the AI provider" concern: ' +
    'POST /api/internal/matching/prepare-embeddings (TypeScript, Phase 05) decides *what* needs embedding and builds the ' +
    'exact text; this workflow calls OpenAI (reusing the existing "OpenAI account" credential, same one ' +
    'cv-analysis-worker.ts already uses) exactly once per run for every pending job+profile combined into a single ' +
    'batched /v1/embeddings request; POST /api/internal/matching/save-embeddings persists the results and ' +
    're-verifies each profile is still matching-eligible before writing. LLM rerank (Phase 06) will extend this same ' +
    'workflow with a second stage, not a new one.',
  [startTrigger, workflowConfiguration],
  { color: 4 }
);

export default workflow('ai-job-agent-02-job-matching', 'AI Job Agent / 02 Job Matching')
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
          .to(saveEmbeddings.onError(logEmbeddingsFailure))
      )
      .onFalse(nothingToEmbed)
  )
  .add(overviewNote);
