// Regression test for mapRawJobsWithAdapter's exception-handler contract:
// the handler must receive only a fixed, strict-allowlist classification —
// never the error object, its message, its own constructor name, or the
// raw item — even if a future adapter's thrown value is a custom Error
// subclass or an object crafted to embed PII in its name or message. Uses
// a synthetic adapter, not a real provider one, so the test proves the
// contract itself rather than relying on today's real adapters staying
// well-behaved.
import test from "node:test";
import assert from "node:assert/strict";
import { mapRawJobsWithAdapter } from "../../src/lib/ingestion/mapRawJobsWithAdapter.ts";

const SENSITIVE = "SSN 123-45-6789, applicant@example.com, salary $250,000";

test("a built-in TypeError (the real-world case: property access on null/undefined) is classified by its real name", () => {
  const adapter = (raw) => {
    return raw.title; // throws TypeError when raw is null — the actual defect this fix targets
  };
  const received = [];
  mapRawJobsWithAdapter([null], adapter, "gulftalent", (index, sourceType, errorKind) => {
    received.push(errorKind);
  });

  assert.deepEqual(received, ["TypeError"]);
});

test("a plain Error whose message embeds sensitive-looking provider content is classified by its allowlisted name only, never its message", () => {
  const adapter = () => {
    throw new Error(`Rejected malformed job: ${SENSITIVE}`);
  };
  const received = [];
  mapRawJobsWithAdapter([{}], adapter, "gulftalent", (index, sourceType, errorKind) => {
    received.push({ index, sourceType, errorKind });
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].errorKind, "Error", "plain Error is an allowlisted built-in name — safe since it's a fixed literal, never derived from content; the message itself is still never read");
  assert.ok(
    !JSON.stringify(received).includes(SENSITIVE),
    "the sensitive message content must never appear anywhere in what the handler receives"
  );
});

test("a subclassed/custom-named Error (even one whose name itself echoes provider content) collapses to the fixed fallback label, not its own constructor name", () => {
  class ProviderFeedError extends Error {}
  const attackerNamedCtor = { [SENSITIVE]: class extends Error {} }[SENSITIVE];
  const received = [];

  mapRawJobsWithAdapter([{}, {}], (raw, i) => {
    throw i === 0 ? new ProviderFeedError("boom") : new attackerNamedCtor("boom");
  }, "oracle_hcm", (index, sourceType, errorKind) => {
    received.push(errorKind);
  });

  assert.deepEqual(received, ["adapter_exception", "adapter_exception"], "only built-in error names ever pass through — any custom/crafted constructor name is rejected, regardless of what it contains");
  assert.ok(!JSON.stringify(received).includes(SENSITIVE), "an attacker-chosen class name must never reach the logged classification");
});

test("a non-Error throw (string, object, number) always collapses to the fixed fallback label, never derived from the thrown value", () => {
  const received = [];
  const adapter = (raw) => {
    if (raw === "string-thrower") throw SENSITIVE;
    if (raw === "object-thrower") throw { leaked: SENSITIVE };
    throw 42;
  };
  mapRawJobsWithAdapter(["string-thrower", "object-thrower", "number-thrower"], adapter, "gulftalent", (index, sourceType, errorKind) => {
    received.push(errorKind);
  });

  assert.deepEqual(received, ["adapter_exception", "adapter_exception", "adapter_exception"]);
  assert.ok(!JSON.stringify(received).includes(SENSITIVE));
});
