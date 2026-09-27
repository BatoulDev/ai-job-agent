# Dependency Security Audit

Branch: `fix/dependency-security-audit`, forked from `fix/security-nextjs-rce` @ `e638a57` (which had already resolved the two critical Next.js RCEs — see `docs/OVERNIGHT_BUILD_FINAL_REPORT.md` and that branch's own commit for that fix). This document covers the **remaining** vulnerabilities flagged after that fix, and the broader dependency/secret-hygiene review requested alongside it.

## 1. Audit before remediation

```
npm audit
```

```
baseline-browser-mapping  >=2.0.0 <2.11.0
Severity: moderate
GHSA-w5vr-8v7q-w6rv — process termination on invalid input causes denial of service

browserslist  <=4.28.6
Severity: high
GHSA-c83g-rgw3-j3cx — unbounded memory growth (no cache eviction), eventual OOM
GHSA-73wf-gq98-2v4g — uncaught crash / prototype write via untrusted browserslist-stats.json

js-yaml  4.0.0 - 4.3.1
Severity: high
GHSA-2883-xcg3-v3hh — maxTotalMergeKeys does not limit CPU use for empty merge sources

3 vulnerabilities (1 moderate, 2 high)
```

```
npm audit --omit=dev
```

```
baseline-browser-mapping  >=2.0.0 <2.11.0
Severity: moderate

1 moderate severity vulnerability
```

**Immediately significant**: only `baseline-browser-mapping` appears in the production-only tree. `browserslist` and `js-yaml` disappear entirely when dev dependencies are omitted — direct evidence (not inference) that they are dev/build-tooling-only exposure.

## 2. Per-vulnerability analysis (evidence, not summary text)

### baseline-browser-mapping

| Field | Value |
|---|---|
| Installed version | 2.10.42 |
| Vulnerable range | `>=2.0.0 <2.11.0` |
| Advisory | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) |
| Severity | Moderate (CVSS score 0 — no vector string published; a DoS via process termination, not memory-safety) |
| Direct or transitive | Transitive |
| Production or dev-only | **Both** — reachable via two independent paths |
| Dependency chain | (a) `next@16.3.6` → `baseline-browser-mapping` directly (production path, confirmed via `npm ls --all`); (b) `eslint-config-next` (dev) → `eslint-plugin-react-hooks` → `@babel/core` → `@babel/helper-compilation-targets` → `browserslist` → `baseline-browser-mapping` (dev path) |
| Reachable in this project | The package is present in the production dependency graph via `next` itself, but this project never invokes browser-target-mapping logic directly — it's Next.js's own build-time tooling. Still treated as reachable/must-fix since it's genuinely in the prod tree, not assumed safe. |
| Recommended version | `>=2.11.0` (latest available: 2.11.26) |
| Update type | Patch/minor (2.10.x → 2.11.x, same major) |
| Breaking-change risk | None — pure data-mapping package, no API surface this project touches |
| Needs a parent upgrade? | No — both declaring parents (`next@^2.9.19`, `browserslist@^2.10.42`) already permit 2.11.26 |
| Would `npm audit fix` do anything unrelated? | No, this one resolves via ordinary dependency-tree refresh |
| **Classification** | **A — confirmed reachable (production tree), fixed** |

### browserslist

| Field | Value |
|---|---|
| Installed version | 4.28.5 |
| Vulnerable range | `<=4.28.6` |
| Advisories | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) (unbounded memory growth/OOM), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) (crash/prototype write via untrusted stats file) |
| Severity | High (CVSS 7.5 each) |
| Direct or transitive | Transitive |
| Production or dev-only | **Dev-only** — absent from `npm audit --omit=dev` |
| Dependency chain | `eslint-config-next` (devDependency) → `eslint-plugin-react-hooks` → `@babel/core` → `@babel/helper-compilation-targets` → `browserslist` |
| Reachable in this project | Only reachable if ESLint's Babel-based tooling is fed an untrusted `browserslist-stats.json` or run against attacker-controlled query input — this project's ESLint run is local/CI tooling only, never network-exposed, never fed external input. Present, not exploitable in this project's actual usage. |
| Recommended version | `>=4.28.7` (latest available: 4.29.1) |
| Update type | Patch/minor (4.28.x → 4.29.x, same major) |
| Breaking-change risk | None — the declaring parent (`@babel/helper-compilation-targets@^4.24.0`) already permits the full 4.x line |
| Needs a parent upgrade? | No |
| Would `npm audit fix` do anything unrelated? | No |
| **Classification** | **C — build/dev tooling only, fixed anyway (safe, in-range, zero cost)** |

### js-yaml

| Field | Value |
|---|---|
| Installed version | 4.3.1 |
| Vulnerable range | `4.0.0 - 4.3.1` |
| Advisory | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) — `maxTotalMergeKeys` does not limit CPU use for empty merge sources (CPU-exhaustion DoS on malicious YAML input) |
| Severity | High (CVSS 7.5) |
| Direct or transitive | Transitive |
| Production or dev-only | **Dev-only** — absent from `npm audit --omit=dev` |
| Dependency chain | `eslint` (devDependency) → `@eslint/eslintrc` → `js-yaml` |
| Reachable in this project | Only reachable if ESLint's config-file YAML parser is fed attacker-controlled YAML — this project's ESLint config is authored locally, never parses untrusted input. Present, not exploitable in this project's actual usage. |
| Recommended version | `>=4.3.2` (latest 4.x: 4.3.2 — a 5.x line also exists but was **not** used, see below) |
| Update type | **Patch** (4.3.1 → 4.3.2, same major, same minor) |
| Breaking-change risk | None |
| Needs a parent upgrade? | No — `@eslint/eslintrc` declares `js-yaml: ^4.1.1`, which already permits 4.3.2 |
| Would `npm audit fix` do anything unrelated? | Not for this package specifically, but see §4 below on why `npm audit fix --force` was avoided project-wide |
| **Classification** | **C — build/dev tooling only, fixed anyway (safe, in-range, zero cost)** |

**Note on js-yaml 5.x**: a major version 5 exists upstream, but was deliberately **not** used — the installed 4.x line already has a non-breaking patched release (4.3.2) that satisfies the declaring parent's own semver range. Jumping to 5.x would be an unnecessary major upgrade of a nested transitive dependency with no benefit here (rule §5: prefer patch over major, avoid upgrades without evidence they're needed).

## 3. Broader security review (per the explicit checklist)

| Check | Result |
|---|---|
| Duplicate vulnerable package versions | None — each of the three flagged packages resolved to exactly one instance in the tree (confirmed via `package-lock.json` inspection), no split-version exposure |
| Stale `overrides`/`resolutions` | None exist in `package.json` — nothing to go stale |
| Package-lock integrity | `npm install --package-lock-only --dry-run` reports "up to date" — lockfile fully in sync with `package.json`, no drift |
| Unsafe dependency pinning | None — no `"*"`, `"latest"`, `git+`, `github:`, or `file:` dependency specifiers anywhere in `package.json` |
| Unexpected install-time lifecycle scripts | Exactly one package in the entire tree declares an install script: `unrs-resolver` (a Rust-based TypeScript resolver used transitively by `eslint-import-resolver-typescript`, devDependency-only). Its `postinstall` fetches the correct native binary via `napi-postinstall` — the standard, well-known pattern used by native Node addons (same approach `esbuild`/`sharp` use). Not a supply-chain concern. |
| Accidental secret files tracked by git | `git ls-files` for `.env*`/`*secret*`/`*credential*`/`*.pem`/`*.key` patterns returns only `.env.example` (the safe, values-free template) plus two legitimate source files whose *names* happen to contain "credential"/"secret" (`docs/OVERNIGHT_CREDENTIALS_REQUIRED.md`, `tests/db/auth-credential-policy.test.mjs`) — no real secret file is tracked |
| Hardcoded credentials/tokens in tracked files | Scanned tracked files for OpenAI-key-shaped strings (`sk-...`), AWS access-key-shaped strings (`AKIA...`), PEM private-key headers, and JWT-shaped strings (`eyJ...eyJ...`) — zero matches |
| Known vulnerable framework/runtime already present | `next` (was 16.3.0, critical RCEs — resolved on the prior `fix/security-nextjs-rce` branch, not this one) was the only framework-level finding; no other framework/runtime package in this tree currently has an open advisory |

No secret values are reproduced anywhere in this document or were printed during the audit, per instruction.

## 4. Remediation performed

```
npm update browserslist js-yaml baseline-browser-mapping
```

This is the minimal possible fix: all three packages are transitive, and their immediate declaring parents already permit the patched versions within their existing semver ranges (`@babel/helper-compilation-targets: browserslist ^4.24.0`, `@eslint/eslintrc: js-yaml ^4.1.1`, `browserslist`/`next`: `baseline-browser-mapping ^2.10.42`/`^2.9.19`). No `package.json` edit was needed or made — confirmed via `git diff package.json` producing no output. Only `package-lock.json` changed.

**Exact version diff** (`package-lock.json` only):

| Package | Before | After |
|---|---|---|
| `baseline-browser-mapping` | 2.10.42 | 2.11.26 |
| `browserslist` | 4.28.5 | 4.29.1 |
| `js-yaml` | 4.3.1 | 4.3.2 |
| `caniuse-lite` | 1.0.30001803 | 1.0.30001812 |
| `electron-to-chromium` | 1.5.389 | 1.5.439 |
| `node-releases` | 2.0.50 | 2.0.57 |
| `update-browserslist-db` | 1.2.3 | 1.3.3 |

The last four are `browserslist`'s own declared internal data dependencies (browser/engine/Chromium version-mapping data files) — they moved incidentally as part of resolving `browserslist` itself to a newer version within its own already-declared ranges. They carry no code-behavior risk (pure data) and were not independently flagged by `npm audit`.

`npm audit fix --force` was deliberately **not** used anywhere in this remediation — every fix here landed within already-permitted ranges via a plain `npm update <name>`, so a forced/unrelated-upgrade tool was never necessary.

## 5. Test results (after remediation)

| Suite | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | Clean |
| Lint | `npm run lint` | Clean |
| Unit | `npm run test:unit` | **529 / 529** |
| Workflow | `npm run test:workflow` | **340 / 340** |
| Database (real local Postgres) | `npm run test:db` | **533 / 533**, 83 suites, zero fixture leakage |
| Production build | `npm run build` | Succeeds, identical 36-route output to before |
| E2E (real Chromium + real dev server + real local Supabase) | `npm run test:e2e` | **6 / 6** |
| Manual smoke | `/`, `/login`, `/dashboard` | 200, 200, 307 — identical to pre-remediation behavior, no runtime errors in the dev server log |

## 6. Audit after remediation

```
npm audit
found 0 vulnerabilities

npm audit --omit=dev
found 0 vulnerabilities
```

## 7. Before vs. after

| | Before this branch's remediation | After |
|---|---|---|
| Full tree vulnerabilities | 3 (1 moderate, 2 high) | **0** |
| Production-only vulnerabilities | 1 (moderate) | **0** |
| Critical vulnerabilities | 0 (the two `next` criticals were already fixed on `fix/security-nextjs-rce`) | 0 |
| Reachable High vulnerabilities | 0 (both High findings were dev-tooling-only, per §2) | 0 |

## 8. Classification summary

| Package | Classification | Status |
|---|---|---|
| `next` (16.3.0 → 16.3.6, prior branch) | A — confirmed critical, affected | **FIXED** (prior branch `fix/security-nextjs-rce`) |
| `sharp` (0.35.3 → 0.35.4, prior branch) | A — confirmed reachable | **FIXED** (prior branch, incidental to the `next` upgrade) |
| `baseline-browser-mapping` | A — confirmed reachable (present in production tree via `next`) | **FIXED** |
| `browserslist` | C — build/dev tooling only, not reachable in this project's actual usage | **FIXED** (safe, zero-cost, no reason not to) |
| `js-yaml` | C — build/dev tooling only, not reachable in this project's actual usage | **FIXED** (safe, zero-cost, no reason not to) |

Nothing fell into B (present but genuinely unreachable and left unfixed), D (false positive), or F (requires a major/breaking upgrade) in this pass — every finding had a same-major, in-range, zero-risk fix available.

## 9. Is the repository safe to proceed into Phase 12?

**Yes.**

- No unresolved Critical vulnerabilities (full tree or production-only).
- No unresolved reachable High vulnerabilities — the only two High findings were dev-tooling-only and have been fixed anyway.
- Production dependency tree (`npm audit --omit=dev`) is completely clean: 0 vulnerabilities.
- Every test suite (unit, workflow, DB, E2E) passes at the same counts as before this change; production build and manual smoke checks are unaffected.
- No `package.json` changes, no breaking-change risk, no unrelated packages touched, no forced/unsafe upgrade path used.
- Broader hygiene checks (secrets, lockfile integrity, pinning, lifecycle scripts, overrides) all came back clean.

`main` remains untouched by this work. This branch (`fix/dependency-security-audit`) and the prior `fix/security-nextjs-rce` branch are both ready for review and merge into `main` at the founder's discretion, but that merge was not performed as part of this task.
