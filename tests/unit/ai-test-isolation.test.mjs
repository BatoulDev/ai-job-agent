// Unit tests for src/lib/matching/aiTestIsolation.ts — the default-off
// allow-list helper used to bound the 2026-11-02 real-AI validation run to
// synthetic rows only. Pure function, no DB, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseIdAllowlist } from "../../src/lib/matching/aiTestIsolation.ts";

describe("parseIdAllowlist", () => {
  test("returns null when unset", () => {
    assert.equal(parseIdAllowlist(undefined, "TEST_VAR"), null);
  });

  test("returns null when empty string", () => {
    assert.equal(parseIdAllowlist("", "TEST_VAR"), null);
  });

  test("returns null when whitespace only", () => {
    assert.equal(parseIdAllowlist("   ", "TEST_VAR"), null);
  });

  test("parses a single UUID", () => {
    assert.deepEqual(parseIdAllowlist("11111111-1111-4111-8111-111111111111", "TEST_VAR"), [
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  test("parses multiple comma-separated UUIDs, trimming whitespace", () => {
    assert.deepEqual(
      parseIdAllowlist(" 11111111-1111-4111-8111-111111111111 , 22222222-2222-4222-8222-222222222222", "TEST_VAR"),
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
    );
  });

  test("throws on a malformed UUID rather than silently dropping it", () => {
    assert.throws(() => parseIdAllowlist("not-a-uuid", "TEST_VAR"), /not a well-formed UUID/);
  });

  test("throws if any one entry in a list is malformed", () => {
    assert.throws(
      () => parseIdAllowlist("11111111-1111-4111-8111-111111111111,garbage", "TEST_VAR"),
      /not a well-formed UUID/
    );
  });
});
