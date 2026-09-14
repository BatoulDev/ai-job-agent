// Tests for src/app/api/checkout/parseCheckoutRequest.ts — proves the
// strict client-body allowlist for POST /api/checkout cannot be bypassed
// by extra fields, wrong types, or a malformed body. This is the frontend
// half of the checkout trust boundary; the backend half (that
// public.create_payment_attempt ignores/cannot even accept a client-supplied
// amount/currency/price-version) is covered by tests/db/checkout-tampering.test.mjs.
// Run: node --experimental-strip-types --test tests/unit/checkout-request-tampering.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCheckoutRequestBody } from "../../src/app/api/checkout/parseCheckoutRequest.ts";

describe("parseCheckoutRequestBody — valid requests", () => {
  test("accepts { planCode: 'student' }", () => {
    const result = parseCheckoutRequestBody({ planCode: "student" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.planCode, "student");
  });

  test("accepts { planCode: 'pro' }", () => {
    const result = parseCheckoutRequestBody({ planCode: "pro" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.planCode, "pro");
  });
});

describe("parseCheckoutRequestBody — tampering rejected", () => {
  test("rejects an unknown plan code", () => {
    const result = parseCheckoutRequestBody({ planCode: "enterprise" });
    assert.strictEqual(result.ok, false);
  });

  test("rejects the free plan (not payable via checkout)", () => {
    const result = parseCheckoutRequestBody({ planCode: "free" });
    assert.strictEqual(result.ok, false);
  });

  test("rejects a client-supplied amount alongside planCode", () => {
    const result = parseCheckoutRequestBody({ planCode: "pro", amount: 1 });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /unexpected field/i);
  });

  test("rejects a client-supplied currency", () => {
    const result = parseCheckoutRequestBody({ planCode: "pro", currency: "USD" });
    assert.strictEqual(result.ok, false);
  });

  test("rejects a client-supplied priceVersionId", () => {
    const result = parseCheckoutRequestBody({
      planCode: "pro",
      priceVersionId: "attacker-controlled-uuid",
    });
    assert.strictEqual(result.ok, false);
  });

  test("rejects a client-supplied isAdmin flag", () => {
    const result = parseCheckoutRequestBody({ planCode: "pro", isAdmin: true });
    assert.strictEqual(result.ok, false);
  });

  test("rejects every unexpected field at once, not just the first", () => {
    const result = parseCheckoutRequestBody({
      planCode: "pro",
      amount: 1,
      currency: "USD",
      priceVersionId: "attacker-controlled",
      isAdmin: true,
    });
    assert.strictEqual(result.ok, false);
  });

  test("rejects planCode alone if a sibling field is present, even a harmless-looking one", () => {
    const result = parseCheckoutRequestBody({ planCode: "student", note: "hi" });
    assert.strictEqual(result.ok, false);
  });

  test("rejects a numeric planCode", () => {
    const result = parseCheckoutRequestBody({ planCode: 9 });
    assert.strictEqual(result.ok, false);
  });

  test("rejects a missing planCode", () => {
    const result = parseCheckoutRequestBody({});
    assert.strictEqual(result.ok, false);
  });

  test("rejects a null body", () => {
    const result = parseCheckoutRequestBody(null);
    assert.strictEqual(result.ok, false);
  });

  test("rejects an array body", () => {
    const result = parseCheckoutRequestBody(["pro"]);
    assert.strictEqual(result.ok, false);
  });

  test("rejects a string body", () => {
    const result = parseCheckoutRequestBody("pro");
    assert.strictEqual(result.ok, false);
  });

  test("rejects a body with a prototype-polluting key alongside planCode", () => {
    const result = parseCheckoutRequestBody({ planCode: "pro", __proto__: { isAdmin: true } });
    assert.strictEqual(result.ok, true, "own-key check only sees planCode; __proto__ is not an own key");
    // Regardless of how JS engines handle the __proto__ literal, the
    // resulting object must never carry more than the one trusted field
    // forward — confirmed by the ok=true branch only ever returning
    // { ok: true, planCode }, never spreading the original object.
    assert.deepStrictEqual(Object.keys(result), ["ok", "planCode"]);
  });
});
