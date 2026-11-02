// Unit tests for src/lib/security/securityHeaders.ts. Pure logic, no DB,
// no network, no next/server import — directly importable under plain
// `node --test`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSecurityHeaders, buildContentSecurityPolicy } from "../../src/lib/security/securityHeaders.ts";

const LOCAL_SUPABASE = "http://127.0.0.1:54321";
const PROD_SUPABASE = "https://abcd1234.supabase.co";

describe("buildSecurityHeaders", () => {
  test("always includes the core header set", () => {
    const headers = buildSecurityHeaders({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    const keys = headers.map((h) => h.key);
    assert.ok(keys.includes("X-Content-Type-Options"));
    assert.ok(keys.includes("X-Frame-Options"));
    assert.ok(keys.includes("Referrer-Policy"));
    assert.ok(keys.includes("Permissions-Policy"));
    assert.ok(keys.includes("Content-Security-Policy"));
  });

  test("X-Content-Type-Options is nosniff", () => {
    const headers = buildSecurityHeaders({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    assert.equal(headers.find((h) => h.key === "X-Content-Type-Options").value, "nosniff");
  });

  test("X-Frame-Options denies framing", () => {
    const headers = buildSecurityHeaders({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    assert.equal(headers.find((h) => h.key === "X-Frame-Options").value, "DENY");
  });

  test("Permissions-Policy disables unused browser features", () => {
    const value = buildSecurityHeaders({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE }).find(
      (h) => h.key === "Permissions-Policy"
    ).value;
    for (const feature of ["camera=()", "microphone=()", "geolocation=()", "payment=()"]) {
      assert.ok(value.includes(feature), `expected Permissions-Policy to disable ${feature}`);
    }
  });

  test("never sends HSTS over plain HTTP, even in prod mode", () => {
    const headers = buildSecurityHeaders({ isDev: false, isHttps: false, supabaseOrigin: PROD_SUPABASE });
    assert.equal(headers.find((h) => h.key === "Strict-Transport-Security"), undefined);
  });

  test("never sends HSTS in dev, even if the request claims https", () => {
    const headers = buildSecurityHeaders({ isDev: true, isHttps: true, supabaseOrigin: LOCAL_SUPABASE });
    assert.equal(headers.find((h) => h.key === "Strict-Transport-Security"), undefined);
  });

  test("sends HSTS only for prod + https", () => {
    const headers = buildSecurityHeaders({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
    assert.ok(hsts);
    assert.ok(hsts.value.includes("max-age=63072000"));
    assert.ok(hsts.value.includes("includeSubDomains"));
    assert.ok(!hsts.value.includes("preload"), "preload must be an explicit separate decision, never a default");
  });
});

describe("buildContentSecurityPolicy", () => {
  test("defaults to self for every fetch-like directive", () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(csp.includes("default-src 'self'"));
  });

  test("allows the real Supabase origin for connect-src and img-src (CV upload/download, auth)", () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(csp.includes(`connect-src 'self' ${PROD_SUPABASE}`));
    assert.ok(csp.includes(`img-src 'self' data: blob: ${PROD_SUPABASE}`));
  });

  test("derives the websocket origin from an https Supabase origin", () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(csp.includes("wss://abcd1234.supabase.co"));
  });

  test("derives the websocket origin from a plain-http local Supabase origin", () => {
    const csp = buildContentSecurityPolicy({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    assert.ok(csp.includes("ws://127.0.0.1:54321"));
  });

  test("blocks framing and plugin/object content entirely — no iframes exist in this app", () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(csp.includes("frame-src 'none'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });

  test("allows unsafe-eval only in dev (React's eval-based debugging), never in prod", () => {
    const devCsp = buildContentSecurityPolicy({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    const prodCsp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(devCsp.includes("'unsafe-eval'"));
    assert.ok(!prodCsp.includes("'unsafe-eval'"));
  });

  test("unsafe-inline is present for script-src and style-src in both envs (documented exception: no nonce/dynamic-rendering refactor)", () => {
    const devCsp = buildContentSecurityPolicy({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    const prodCsp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    for (const csp of [devCsp, prodCsp]) {
      assert.match(csp, /script-src[^;]*'unsafe-inline'/);
      assert.match(csp, /style-src[^;]*'unsafe-inline'/);
    }
  });

  test("never contains a wildcard source", () => {
    const csp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(!csp.includes("*"), "CSP must not use a blanket wildcard");
  });

  test("upgrade-insecure-requests only in prod", () => {
    const devCsp = buildContentSecurityPolicy({ isDev: true, isHttps: false, supabaseOrigin: LOCAL_SUPABASE });
    const prodCsp = buildContentSecurityPolicy({ isDev: false, isHttps: true, supabaseOrigin: PROD_SUPABASE });
    assert.ok(!devCsp.includes("upgrade-insecure-requests"));
    assert.ok(prodCsp.includes("upgrade-insecure-requests"));
  });
});
