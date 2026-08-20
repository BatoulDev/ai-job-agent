// Tests for src/lib/cvAnalysis/confirm.client.ts
// Run: node --experimental-strip-types --test tests/unit/confirm-cv-analysis-request.test.mjs
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { confirmCvAnalysisRequest } from "../../src/lib/cvAnalysis/confirm.client.ts";

const EXPECTED_ENDPOINT = "/api/cv-analysis/confirm";
const ANALYSIS_ID = "94d38876-da58-4cf2-abf8-3dfc4362592b";

const MOCK_APPROVED_ANALYSIS = {
  id: ANALYSIS_ID,
  user_id: "user-uuid",
  cv_id: "cv-uuid",
  status: "completed",
  review_status: "approved",
  is_current: true,
  recommendations_state: "current",
};

// Save and restore globalThis.fetch around each test group to keep tests
// hermetic — each test replaces fetch, the after() hook puts the original back.
describe("confirmCvAnalysisRequest — HTTP contract", () => {
  let originalFetch;
  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  test("calls the correct endpoint with POST method", async () => {
    let capturedUrl;
    let capturedMethod;
    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedMethod = options?.method;
      return { ok: true, json: async () => ({ analysis: MOCK_APPROVED_ANALYSIS }) };
    };

    await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(capturedUrl, EXPECTED_ENDPOINT, "must call /api/cv-analysis/confirm");
    assert.strictEqual(capturedMethod, "POST", "must use POST method");
  });

  test("sends Content-Type: application/json header", async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, options) => {
      capturedHeaders = options?.headers ?? {};
      return { ok: true, json: async () => ({ analysis: MOCK_APPROVED_ANALYSIS }) };
    };

    await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(
      capturedHeaders["Content-Type"],
      "application/json",
      "must include Content-Type: application/json"
    );
  });

  test("sends analysisId in the JSON body", async () => {
    let capturedBody;
    globalThis.fetch = async (_url, options) => {
      capturedBody = JSON.parse(options?.body ?? "{}");
      return { ok: true, json: async () => ({ analysis: MOCK_APPROVED_ANALYSIS }) };
    };

    await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(
      capturedBody.analysisId,
      ANALYSIS_ID,
      "body must contain analysisId matching the argument"
    );
  });
});

describe("confirmCvAnalysisRequest — success path", () => {
  let originalFetch;
  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  test("returns ok=true and the approved analysis on 2xx response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ analysis: MOCK_APPROVED_ANALYSIS }),
    });

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.ok, true, "ok must be true on success");
    assert.deepStrictEqual(
      result.analysis,
      MOCK_APPROVED_ANALYSIS,
      "analysis must match the server response"
    );
  });

  test("returned analysis has review_status=approved and is_current=true", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ analysis: MOCK_APPROVED_ANALYSIS }),
    });

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.analysis?.review_status, "approved");
    assert.strictEqual(result.analysis?.is_current, true);
  });
});

describe("confirmCvAnalysisRequest — failure paths", () => {
  let originalFetch;
  before(() => { originalFetch = globalThis.fetch; });
  after(() => { globalThis.fetch = originalFetch; });

  test("returns ok=false with the server error message on non-2xx", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "This analysis is not ready to confirm." }),
    });

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.ok, false, "ok must be false on 4xx");
    assert.strictEqual(
      result.message,
      "This analysis is not ready to confirm.",
      "must surface the server error message"
    );
    assert.strictEqual(result.analysis, undefined, "analysis must be undefined on failure");
  });

  test("returns generic message when non-2xx body lacks error field", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.ok, false);
    assert.ok(
      typeof result.message === "string" && result.message.length > 0,
      "must return a non-empty fallback message"
    );
    assert.strictEqual(result.analysis, undefined);
  });

  test("returns ok=false with network error message when fetch throws", async () => {
    globalThis.fetch = async () => { throw new Error("Network failure"); };

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.ok, false, "ok must be false on network error");
    assert.ok(
      result.message?.includes("reach the server"),
      `message should indicate server unreachability, got: "${result.message}"`
    );
    assert.strictEqual(result.analysis, undefined);
  });

  test("returns ok=false when response body is not parseable JSON", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });

    const result = await confirmCvAnalysisRequest(ANALYSIS_ID);

    assert.strictEqual(result.ok, false);
    assert.ok(typeof result.message === "string" && result.message.length > 0);
  });
});
