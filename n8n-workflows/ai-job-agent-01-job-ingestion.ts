import { workflow, node, trigger, sticky, splitInBatches, nextBatch, switchCase, newCredential, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Job Ingestion Run' },
});

const workflowConfiguration = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Workflow Configuration',
    parameters: {
      mode: 'raw',
      jsonOutput: {
        appBaseUrl: 'http://host.docker.internal:3000',
        maxJobsPerSource: 5,
        rateLimitDelaySeconds: 2,
        dryRun: true,
      },
    },
  },
  output: [{ appBaseUrl: 'http://host.docker.internal:3000', maxJobsPerSource: 5, rateLimitDelaySeconds: 2, dryRun: true }],
});

const listIngestionSources = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List Ingestion Sources',
    notes:
      'Discovers verified, automatable company_sources rows dynamically (Phase 12), plus enabled multi-company feed ' +
      'providers and career-page extraction candidates (Phase 13). See src/lib/ingestion/findEligibleCompanySources.ts, ' +
      'multiCompanyFeedUrls.ts, findCareerPageExtractionCandidates.ts.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
    parameters: {
      method: 'POST',
      url: expr('{{ $json.appBaseUrl }}/api/internal/ingestion/list-sources'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ {} }}'),
      options: { timeout: 30000 },
    },
  },
  output: [
    {
      sources: [{ source_id: 'sr-sa-alpaca', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true' }],
      multi_company_sources: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
      career_page_candidates: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
    },
  ],
});

const logListSourcesFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log List Sources Failure',
    notes: 'Terminal failure for this run — nothing to loop over if source discovery itself failed. A human reviews the n8n execution log.',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'list-sources call failed' }}"), type: 'string' }] },
    },
  },
  output: [{ error: 'list-sources call failed' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier A: company-specific ATS sources (Greenhouse/Lever/Workable/Ashby/Oracle Cloud Recruiting)
// ─────────────────────────────────────────────────────────────────────────

const splitOutSources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Sources',
    parameters: { fieldToSplitOut: 'sources' },
  },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' }],
});

const loopSources = splitInBatches({
  version: 3,
  config: { name: 'Loop Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' }],
});

const fetchSourceJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Source Jobs',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 4,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 15000 },
    },
  },
  output: [{ jobs: [{ id: 1, title: 'Sample Job', absolute_url: 'https://example.test/1', content: '<p>desc</p>', location: { name: 'Remote' } }] }],
});

const extractJobsByAtsType = switchCase({
  version: 3.4,
  config: {
    name: 'Extract Jobs By ATS Type',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'greenhouse',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'greenhouse' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'lever',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'lever' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'workable',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'workable' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'ashby',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'ashby' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'oracle_hcm',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'oracle_hcm' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unsupported' },
    },
  },
  output: [{ jobs: [] }],
});

const extractGreenhouseJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Greenhouse Jobs',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

// Lever's postings API returns a bare top-level array — n8n's core
// JSON-to-items conversion auto-splits it, so items are already individual
// raw jobs by the time they reach this branch (same behavior as RemoteOK's
// Tier D branch below). Confirmed live in Phase 14: a real 21-job Wahed
// response produced 21 separate items, each individually failing
// downstream, before this Aggregate node was added.
const aggregateLeverJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Lever Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: 'abc-123', text: 'Fixture Role' }] }],
});

const extractLeverJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Lever Jobs',
    notes: "Lever's postings API returns a bare top-level array, auto-split by n8n into one item per job — Aggregate Lever Jobs collects them back into a single {jobs:[...]} item before this node runs (Phase 14 fix; docs/job-ingestion-pilot.md §5).",
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

const extractWorkableJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Workable Jobs',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

const extractAshbyJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Ashby Jobs',
    notes: 'Phase 13. Ashby posting-api returns {jobs:[...], apiVersion} — confirmed live against a real registry board (sr-qa-the-utopia-studio).',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

// Phase 16. Oracle's recruitingCEJobRequisitions response nests the real job
// list at items[0].requisitionList and carries no candidate-facing URL of
// its own (only internal hcmRestApi self-links) — the real, public apply
// URL lives at a sibling path, {host}/hcmUI/CandidateExperience/en/sites/
// {site}/job/{id}, confirmed live this phase (docs/LEBANON_GULF_SOURCE_RESEARCH.md
// §3). This expression derives that host+site from the same feed_url
// Fetch Source Jobs already used, and stamps it onto every raw job so
// providers/oracle-hcm.ts (a plain (raw) => RawProviderJob function, no
// per-batch context parameter) can build a real applicationUrl without
// inventing one.
const extractOracleHcmJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Oracle HCM Jobs',
    notes:
      'Phase 16. Confirmed live against a real registry tenant (AUBMC, Lebanon) — a direct unauthenticated GET to ' +
      'recruitingCEJobRequisitions returned real job data, and the derived candidate-facing URL returned a real 200 job page. ' +
      'See providers/oracle-hcm.ts and deriveAtsFeedUrl.ts.',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          {
            id: 'rawJobs',
            name: 'rawJobs',
            value: expr(
              '={{ (() => {\n' +
                "  const feedUrl = $('Split Out Sources').item.json.feed_url;\n" +
                '  const m = feedUrl.match(/^https:\\/\\/([^/]+)\\/hcmRestApi.*siteNumber=([A-Za-z0-9_]+)/);\n' +
                '  const candidateSiteUrl = m ? `https://${m[1]}/hcmUI/CandidateExperience/en/sites/${m[2]}` : null;\n' +
                '  const list = $json.items?.[0]?.requisitionList ?? [];\n' +
                '  return list.map((job) => ({ ...job, candidateSiteUrl }));\n' +
                '})() }}'
            ),
            type: 'array',
          },
        ],
      },
    },
  },
  output: [{ rawJobs: [] }],
});

const SOURCE_ID_ASSIGNMENT = { id: 'source_id', name: 'source_id', value: expr("{{ $('Split Out Sources').item.json.source_id }}"), type: 'string' };
const ATS_TYPE_ASSIGNMENT = { id: 'ats_type', name: 'ats_type', value: expr("{{ $('Split Out Sources').item.json.ats_type }}"), type: 'string' };

const buildUnsupportedSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Unsupported Source Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'unsupported_ats_type', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: 'no adapter registered for this ats_type', type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'indeed', outcome: 'unsupported_ats_type', succeeded: false }],
});

const buildFetchFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Fetch Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'fetch_failed', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'fetch failed after retries' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'fetch_failed', succeeded: false }],
});

const callIngestionBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Ingestion Batch Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceId: $('Split Out Sources').item.json.source_id,\n" +
          "  sourceType: $('Split Out Sources').item.json.ats_type,\n" +
          '  rawJobs: $json.rawJobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const buildSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' },
          { id: 'error', name: 'error', value: null, type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'succeeded', succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false, error: null }],
});

const buildEndpointFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Endpoint Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'endpoint_call_failed', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'ingestion batch endpoint call failed after retries' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'endpoint_call_failed', succeeded: false }],
});

const recordSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Source Result',
    notes: "Pure convergence point — every per-source path (success, fetch failure, endpoint-call failure, unsupported ats_type) lands here with the same shape. Each iteration's outcome is visible in this node's own execution history in the n8n UI (no combined summary node — see the overview sticky note).",
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'succeeded', succeeded: true }],
});

const rateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ source_id: 'sr-x' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier D (Phase 13): multi-company feeds (RemoteOK/Jobicy/Arbeitnow).
// Every branch normalizes to the same {jobs:[...]} shape before converging
// on one shared endpoint-call node — mirrors Tier A's
// extractGreenhouse/Lever/Workable/Ashby/OracleHcmJobs -> callIngestionBatchEndpoint
// convergence pattern above.
// ─────────────────────────────────────────────────────────────────────────

const splitOutMultiCompanySources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Multi-Company Sources',
    parameters: { fieldToSplitOut: 'multi_company_sources' },
  },
  output: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
});

const loopMultiCompanySources = splitInBatches({
  version: 3,
  config: { name: 'Loop Multi-Company Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
});

const fetchMultiCompanyFeed = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Multi-Company Feed',
    notes:
      'First page only, deliberately — Arbeitnow is the only paginated provider here and its remote:true jobs are a ' +
      'small subset of page 1; native HTTP pagination was judged not worth the added complexity this phase. See ' +
      'docs/PROVIDER_EXPANSION_IMPLEMENTATION.md.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 20000 },
    },
  },
  output: [{ id: '1137431', company: 'Fixture Co', position: 'Engineer', description: '<p>desc</p>', apply_url: 'https://remoteok.com/x', url: 'https://remoteok.com/x', date: '2026-09-01T00:00:00Z' }],
});

const extractRawJobsByProviderType = switchCase({
  version: 3.4,
  config: {
    name: 'Extract Raw Jobs By Provider Type',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'remoteok',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'remoteok' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'jobicy',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'jobicy' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'arbeitnow',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'arbeitnow' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unsupported' },
    },
  },
  output: [{ id: '1137431' }],
});

// RemoteOK's top-level response is a raw JSON array — n8n's core JSON-to-
// items conversion auto-splits it, so items are already individual raw
// jobs (item 0 is always RemoteOK's own legend/metadata object, which
// lacks id/company/title — harmlessly rejected downstream as
// missing_company_name, not filtered here, to keep this branch as simple
// as the other two).
const aggregateRemoteOkJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate RemoteOK Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: '1137431', company: 'Fixture Co' }] }],
});

const splitOutJobicyJobs = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: { name: 'Split Out Jobicy Jobs', parameters: { fieldToSplitOut: 'jobs' } },
  output: [{ id: 151756, companyName: 'Fixture Co' }],
});

const aggregateJobicyJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Jobicy Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: 151756, companyName: 'Fixture Co' }] }],
});

const splitOutArbeitnowJobs = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: { name: 'Split Out Arbeitnow Jobs', parameters: { fieldToSplitOut: 'data' } },
  output: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }],
});

const filterArbeitnowRemote = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Filter Arbeitnow Remote Only',
    notes: "Arbeitnow's feed is dominated by DACH-region onsite listings — only remote:true rows are relevant to this project's international-remote lane (see docs/PROVIDER_EXPANSION_IMPLEMENTATION.md).",
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.remote }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: true }],
        combinator: 'and',
      },
      options: {},
    },
  },
  output: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }],
});

const aggregateArbeitnowJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Arbeitnow Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }] }],
});

const callMultiCompanyBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Multi-Company Batch Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: $('Split Out Multi-Company Sources').item.json.provider_type,\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT = {
  id: 'provider_type',
  name: 'provider_type',
  value: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"),
  type: 'string',
};

const buildMultiCompanySuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Multi-Company Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ provider_type: 'remoteok', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildMultiCompanyFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Multi-Company Failure Result',
    notes: 'Shared failure builder for fetch failures, endpoint-call failures, and an unsupported provider_type (defensive — providerConfig.ts/multiCompanyFeedUrls.ts never actually emit one).',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'multi-company batch failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'remoteok', succeeded: false, error: 'fetch failed after retries' }],
});

const recordMultiCompanySourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Multi-Company Source Result',
    notes: 'Convergence point for the Tier-D loop, same purpose as Record Source Result above — one execution-history entry per provider per run.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ provider_type: 'remoteok', succeeded: true }],
});

const multiCompanyRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Multi-Company Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ provider_type: 'remoteok' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Apify-sourced multi-company feeds (Phase 21): Bayt, GulfTalent, Indeed.
// These cannot go through the Tier D loop above — that loop's Fetch
// Multi-Company Feed node does a plain GET against a feed_url, while each
// of these needs a POST with a per-provider request body to Apify's
// run-sync-get-dataset-items endpoint (a fundamentally different HTTP
// shape) — so this is its own fully isolated branch (provider isolation),
// not an extra case bolted onto the Tier D switch. A static seed list, not
// dynamic discovery: these providers cannot be discovered the way
// getEnabledMultiCompanyFeedSources() discovers RemoteOK/Jobicy/Arbeitnow
// (it only ever builds GET feed URLs), so their markets are hardcoded here
// to exactly what Phase 21 live-benchmarked. Real per-provider findings —
// schema drift, apply-link provenance, GulfTalent needing a location hint
// for some markets — are documented in providers/bayt.ts, gulftalent.ts,
// indeed.ts and docs/LEBANON_LIVE_SOURCE_EXPANSION.md, not repeated here.
// ─────────────────────────────────────────────────────────────────────────

const apifyMultiCompanySourceSeeds = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Apify Multi-Company Source Seeds',
    notes:
      'Static seed list — bounded to the real markets live-benchmarked this phase (Bayt: Lebanon; GulfTalent: Saudi ' +
      'Arabia + UAE/Dubai; Indeed: UAE/Dubai only — Indeed and GulfTalent both real-confirmed to have no Lebanon ' +
      'country option). Qatar/Kuwait not yet included — add once benchmarked.',
    parameters: {
      mode: 'raw',
      jsonOutput: {
        apify_sources: [
          {
            provider_type: 'bayt',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items',
            request_body: { country: 'LB', maxResults: 25 },
          },
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper/run-sync-get-dataset-items',
            request_body: { country: 'SA', maxResults: 15 },
          },
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper/run-sync-get-dataset-items',
            request_body: { country: 'AE', location: 'Dubai', maxResults: 15 },
          },
          {
            provider_type: 'indeed',
            actor_url: 'https://api.apify.com/v2/acts/curious_coder~indeed-scraper/run-sync-get-dataset-items',
            request_body: { country: 'ae', location: 'Dubai', count: 15 },
          },
        ],
      },
    },
  },
  output: [{ apify_sources: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 } }] }],
});

const splitOutApifySources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Apify Sources',
    parameters: { fieldToSplitOut: 'apify_sources' },
  },
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 } }],
});

const loopApifySources = splitInBatches({
  version: 3,
  config: { name: 'Loop Apify Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 } }],
});

const callApifyActor = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Apify Actor',
    notes:
      "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI — programmatic credential binding for " +
      'generic-auth types on this node is a confirmed n8n MCP tool limitation (reported separately), not a project issue.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('{{ $json.actor_url }}'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.request_body }}'),
      options: { timeout: 60000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }],
});

const aggregateApifyJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Apify Jobs',
    notes:
      "Apify's run-sync-get-dataset-items returns a bare top-level array, same as Lever — n8n auto-splits it into one " +
      'item per job, so this re-aggregates back into one {jobs:[...]} item before the batch endpoint call (mirrors ' +
      'Aggregate Lever Jobs / Aggregate RemoteOK Jobs).',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }] }],
});

const callApifyBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Apify Batch Endpoint',
    notes:
      'Same shared batch endpoint the Tier D branch uses — a separate node (not reused directly) because its ' +
      "sourceType expression must resolve $('Split Out Apify Sources'), a different ancestor than the Tier D branch's " +
      "$('Split Out Multi-Company Sources'). Credential 'Ingestion Worker Secret' must be bound manually in the n8n " +
      'UI, same confirmed MCP tool limitation as Call Apify Actor above.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: $('Split Out Apify Sources').item.json.provider_type,\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 25, jobsValid: 25, jobsRejected: 0, jobsCreated: 25, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const APIFY_PROVIDER_TYPE_ASSIGNMENT = {
  id: 'provider_type',
  name: 'provider_type',
  value: expr("{{ $('Split Out Apify Sources').item.json.provider_type }}"),
  type: 'string',
};

const buildApifySuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Apify Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [APIFY_PROVIDER_TYPE_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ provider_type: 'bayt', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildApifyFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Apify Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          APIFY_PROVIDER_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'apify actor or batch call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'bayt', succeeded: false, error: 'apify actor or batch call failed' }],
});

const recordApifySourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Apify Source Result',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ provider_type: 'bayt', succeeded: true }],
});

const apifyRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Apify Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ provider_type: 'bayt' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier B (Phase 13): career-page extraction. Company-specific (one
// company_sources row each), so it reuses the SAME
// /api/internal/ingestion/run-batch endpoint as Tier A above — the only
// new step is fetching + extracting HTML before that call.
// ─────────────────────────────────────────────────────────────────────────

const splitOutCareerPageCandidates = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Career Page Candidates',
    parameters: { fieldToSplitOut: 'career_page_candidates' },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
});

const loopCareerPageCandidates = splitInBatches({
  version: 3,
  config: { name: 'Loop Career Page Candidates (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
});

const fetchCareerPageHtml = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Career Page HTML',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.careers_url }}'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; ai-job-agent-ingestion/1.0)' }] },
      options: { timeout: 20000, response: { response: { responseFormat: 'text', outputPropertyName: 'html' } } },
    },
  },
  output: [{ html: '<html><body>Careers page</body></html>' }],
});

const callExtractCareerPageJobsEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Extract Career Page Jobs Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/extract-career-page-jobs"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { html: $json.html } }}'),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ jobs: [] }],
});

const callCareerPageIngestionBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Career Page Ingestion Batch Endpoint',
    notes: 'Same shared run-batch endpoint Tier A calls — career_page is a company-specific source_type (jobs.source_type check constraint already allowed it before Phase 13).',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceId: $('Split Out Career Page Candidates').item.json.source_id,\n" +
          "  sourceType: 'career_page',\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'no_valid_jobs', jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const CAREER_PAGE_SOURCE_ID_ASSIGNMENT = {
  id: 'source_id',
  name: 'source_id',
  value: expr("{{ $('Split Out Career Page Candidates').item.json.source_id }}"),
  type: 'string',
};

const buildCareerPageSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Career Page Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [CAREER_PAGE_SOURCE_ID_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' || $json.outcome === 'no_valid_jobs' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', outcome: 'no_valid_jobs', succeeded: true, error: null }],
});

const buildCareerPageFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Career Page Failure Result',
    notes: 'Shared failure builder for HTML-fetch failures, extraction-endpoint failures, and ingestion-batch-endpoint failures.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          CAREER_PAGE_SOURCE_ID_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'career page ingestion failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', succeeded: false, error: 'fetch failed after retries' }],
});

const recordCareerPageSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Career Page Source Result',
    notes: 'Convergence point for the Tier-B loop, same purpose as Record Source Result above.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', succeeded: true }],
});

const careerPageRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Career Page Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky notes
// ─────────────────────────────────────────────────────────────────────────

const overviewNote = sticky(
  '### AI Job Agent / 01 Job Ingestion\n' +
    'Manual trigger, stays inactive until a human reviews a `local_pilot`-equivalent run (dryRun:false) and decides on a schedule. ' +
    'n8n owns provider HTTP calls + retry/backoff (native `retryOnFail`) + per-source rate limiting; ALL validation, ' +
    'field mapping, dedup identity, idempotent persistence, and stale-close safety live in src/lib/ingestion/* (Phase 03) ' +
    "behind three internal endpoints (run-batch, run-multi-company-batch, extract-career-page-jobs), which also re-verify " +
    'authorization live on every call — n8n never needs Supabase access for this workflow at all.\n\n' +
    "No combined execution-summary node: n8n's cross-loop-iteration item linking does not reliably expose every " +
    "iteration's result to a single downstream node once a loop's done output fires (confirmed by direct testing — " +
    "`.all()` from that branch only resolved the last iteration). Each source/provider's real outcome is fully visible " +
    "per-iteration in each tier's own Record *Result node execution history in the n8n UI, sufficient for this " +
    'manually-reviewed, inactive workflow. Revisit if this is ever scheduled unattended and a single rollup ' +
    'notification becomes necessary.',
  [startTrigger, workflowConfiguration],
  { color: 4 }
);

const scopeLimitationNote = sticky(
  '### Dynamic source discovery (Phase 12) + three-tier orchestration (Phase 13)\n' +
    'One POST /api/internal/ingestion/list-sources call now returns three independent arrays this workflow fans out ' +
    'to below: (1) Tier-A company-specific ATS sources (Greenhouse/Lever/Workable/Ashby/Oracle Cloud Recruiting — ' +
    'findEligibleCompanySources.ts), (2) Tier-D enabled multi-company feeds (RemoteOK/Jobicy/Arbeitnow — ' +
    'multiCompanyFeedUrls.ts + providerConfig.ts), (3) Tier-B career-page extraction candidates ' +
    '(findCareerPageExtractionCandidates.ts). Each tier is its own modular loop with its own rate limit, converging on ' +
    'a shared endpoint per tier — no provider-specific matching/eligibility logic anywhere downstream of ingestion. ' +
    'See docs/PROVIDER_EXPANSION_IMPLEMENTATION.md for exact live-tested vs fixture-only status per provider, and ' +
    "why JSearch/Adzuna/Bayt/GulfTalent remain enabled:false (providerConfig.ts) — BLOCKED_ON_CREDENTIAL or " +
    'BLOCKED_ON_AUTHORIZATION, not implemented as a no-op here.',
  [listIngestionSources],
  { color: 6 }
);

const multiCompanyNote = sticky(
  '### Tier D: multi-company feeds (Phase 13)\n' +
    "RemoteOK/Jobicy/Arbeitnow are live, free, public APIs — no credential required. Each branch normalizes its own " +
    'raw response shape (RemoteOK: auto-split top-level array; Jobicy/Arbeitnow: Split Out + Aggregate their nested ' +
    "array field) down to one common {jobs:[...]} shape before converging on Call Multi-Company Batch Endpoint, " +
    'mirroring how Tier A above converges on Call Ingestion Batch Endpoint. First page only — see Fetch Multi-Company ' +
    "Feed's own note for why native pagination was skipped this phase.",
  [splitOutMultiCompanySources],
  { color: 5 }
);

const careerPageNote = sticky(
  '### Tier B: career-page extraction (Phase 13)\n' +
    'Fetches a real company_sources.official_careers_url and extracts schema.org JobPosting JSON-LD ' +
    '(extractCareerPageJobPostings.ts) — no headless browser, no Apify, no arbitrary scraping. Honest finding this ' +
    'phase: 0 of 11 sampled real candidates (Byblos Bank, touch Lebanon, Caritas Lebanon, Lebanese Red Cross, KPMG, ' +
    'Anghami, Whish Money, Mercy Corps, Deloitte, EY, Bank Audi) emit this markup on their recorded ' +
    'official_careers_url — that URL is almost always a landing/overview page, while JobPosting markup typically ' +
    "lives on an individual job's own detail page. The pipeline is real and live-tested end-to-end (fetch + extract " +
    'against a real page returns an honest 0, not an error) and will start yielding jobs automatically, with zero ' +
    'code changes, the moment any candidate page — or a future per-job-detail-page discovery step — actually emits ' +
    'this markup. See docs/PROVIDER_EXPANSION_IMPLEMENTATION.md.',
  [splitOutCareerPageCandidates],
  { color: 7 }
);

const apifyMultiCompanyNote = sticky(
  '### Apify-sourced multi-company feeds (Phase 21)\n' +
    'Bayt, GulfTalent, and Indeed — all three via Apify actor calls (POST run-sync-get-dataset-items), not a plain ' +
    'GET feed URL, so this branch is fully isolated from the Tier D loop above rather than an extra switch case. ' +
    'Static seed list, not dynamic discovery — these providers cannot be found the way ' +
    'getEnabledMultiCompanyFeedSources() finds RemoteOK/Jobicy/Arbeitnow. Real live-benchmark findings (schema drift, ' +
    'applyUrl provenance, per-market quirks) are in providers/bayt.ts, gulftalent.ts, indeed.ts and ' +
    'docs/LEBANON_LIVE_SOURCE_EXPANSION.md. Both new HTTP nodes need their credential bound manually in the n8n UI ' +
    "(a confirmed MCP tool limitation, not a project issue) — Call Apify Actor needs 'AI Job Guide - Apify', Call " +
    "Apify Batch Endpoint needs 'Ingestion Worker Secret'.",
  [apifyMultiCompanySourceSeeds],
  { color: 3 }
);

export default workflow('ai-job-agent-01-job-ingestion', 'AI Job Agent / 01 Job Ingestion')
  .add(startTrigger)
  .to(workflowConfiguration)
  .to(listIngestionSources.onError(logListSourcesFailure))
  .to(splitOutSources)
  .to(
    loopSources.onEachBatch(
      fetchSourceJobs
        .onError(buildFetchFailureResult)
        .to(
          extractJobsByAtsType
            .onCase(0, extractGreenhouseJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(1, aggregateLeverJobs.to(extractLeverJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint)))
            .onCase(2, extractWorkableJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(3, extractAshbyJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(4, extractOracleHcmJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(5, buildUnsupportedSourceResult.to(recordSourceResult))
        )
    )
  )
  .add(callIngestionBatchEndpoint.onError(buildEndpointFailureResult))
  .to(buildSuccessResult)
  .to(recordSourceResult)
  .add(buildFetchFailureResult)
  .to(recordSourceResult)
  .add(buildEndpointFailureResult)
  .to(recordSourceResult)
  .add(recordSourceResult)
  .to(rateLimitDelay)
  .to(nextBatch(loopSources))

  // Tier D: multi-company feeds — second independent branch off List Ingestion Sources' success output.
  .add(listIngestionSources)
  .to(splitOutMultiCompanySources)
  .to(
    loopMultiCompanySources.onEachBatch(
      fetchMultiCompanyFeed
        .onError(buildMultiCompanyFailureResult)
        .to(
          extractRawJobsByProviderType
            .onCase(0, aggregateRemoteOkJobs.to(callMultiCompanyBatchEndpoint))
            .onCase(1, splitOutJobicyJobs.to(aggregateJobicyJobs.to(callMultiCompanyBatchEndpoint)))
            .onCase(2, splitOutArbeitnowJobs.to(filterArbeitnowRemote.to(aggregateArbeitnowJobs.to(callMultiCompanyBatchEndpoint))))
            .onCase(3, buildMultiCompanyFailureResult)
        )
    )
  )
  .add(callMultiCompanyBatchEndpoint.onError(buildMultiCompanyFailureResult))
  .to(buildMultiCompanySuccessResult)
  .to(recordMultiCompanySourceResult)
  .add(buildMultiCompanyFailureResult)
  .to(recordMultiCompanySourceResult)
  .add(recordMultiCompanySourceResult)
  .to(multiCompanyRateLimitDelay)
  .to(nextBatch(loopMultiCompanySources))

  // Tier B: career-page extraction — third independent branch off List Ingestion Sources' success output.
  .add(listIngestionSources)
  .to(splitOutCareerPageCandidates)
  .to(
    loopCareerPageCandidates.onEachBatch(
      fetchCareerPageHtml
        .onError(buildCareerPageFailureResult)
        .to(callExtractCareerPageJobsEndpoint.onError(buildCareerPageFailureResult).to(callCareerPageIngestionBatchEndpoint))
    )
  )
  .add(callCareerPageIngestionBatchEndpoint.onError(buildCareerPageFailureResult))
  .to(buildCareerPageSuccessResult)
  .to(recordCareerPageSourceResult)
  .add(buildCareerPageFailureResult)
  .to(recordCareerPageSourceResult)
  .add(recordCareerPageSourceResult)
  .to(careerPageRateLimitDelay)
  .to(nextBatch(loopCareerPageCandidates))

  // Apify-sourced multi-company feeds (Phase 21): Bayt/GulfTalent/Indeed —
  // fourth independent branch, static seeds rather than off List Ingestion
  // Sources (these providers are not dynamically discoverable).
  .add(workflowConfiguration)
  .to(apifyMultiCompanySourceSeeds)
  .to(splitOutApifySources)
  .to(loopApifySources.onEachBatch(callApifyActor.onError(buildApifyFailureResult).to(aggregateApifyJobs.to(callApifyBatchEndpoint))))
  .add(callApifyBatchEndpoint.onError(buildApifyFailureResult))
  .to(buildApifySuccessResult)
  .to(recordApifySourceResult)
  .add(buildApifyFailureResult)
  .to(recordApifySourceResult)
  .add(recordApifySourceResult)
  .to(apifyRateLimitDelay)
  .to(nextBatch(loopApifySources))

  .add(overviewNote)
  .add(scopeLimitationNote)
  .add(multiCompanyNote)
  .add(careerPageNote)
  .add(apifyMultiCompanyNote);
