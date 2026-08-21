# Production Readiness Tracker

Living record of the 2026-08-21 production-readiness and security audit, updated as controls are implemented or re-verified. This file is the source of truth — AGENTS.md §34 states the same thing: a written rule is not proof a control exists.

**Statuses used:** `Implemented` · `Partially Implemented` · `Not Implemented` · `Not Applicable Yet` · `Cannot Verify`

**How to read "Verification status":** who checked this, when, and how — not just whether it currently looks true. A row is only `Implemented` when its evidence was actually re-read/re-run at the date shown, not recalled from a prior audit.

---

## How this tracker stays accurate

- **Every PR** that touches an endpoint, table, or workflow listed below updates the corresponding row in the same PR — not a follow-up.
- **Every CI run** exercises whatever is wired into `npm test` (see CI-01/TEST-01 below) — a green CI run is evidence only for what actually ran.
- **Before every deployment**, re-check any row whose evidence lives outside this repo (Supabase dashboard settings, GitHub branch protection) — CI cannot verify those.
- **Monthly, post-launch**, re-verify every `Cannot Verify` row against the live project, and spot-check a few `Implemented` rows against current code to catch silent regressions.
- A control may only be marked `Implemented` when the evidence cited was read or executed at the "Last verified" date — not inferred from this document's own history.

---

## Phase 1 — completed 2026-08-21 (this change)

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| `npm test` runs unit + workflow + DB suites in one deterministic command | **Implemented** | Low | Before starting Automation 2 | `package.json`: `"test": "npm run test:unit && npm run test:workflow && npm run test:db"`; `test:unit`/`test:workflow`/`test:db` each runnable independently | None — keep new suites wired into all three as they're added | Verified 2026-08-21: `npm test` executed locally, 344/344 tests passing (121 unit + 103 workflow + 120 db) |
| CI runs unit and workflow tests | **Implemented** | Low | Before starting Automation 2 | `.github/workflows/ci.yml`: `Unit tests` (`npm run test:unit`) and `Workflow tests` (`npm run test:workflow`) steps, before `Build` | None | Verified 2026-08-21: YAML validated with `js-yaml`; steps run the same scripts confirmed locally |
| CI runs DB integration tests (`tests/db`) | **Not Implemented** | Medium | Before starting Automation 2 | `.github/workflows/ci.yml` has a comment explaining the exclusion; no `test:db` step exists | See "DB tests in CI" section below — requires a validated `supabase/setup-cli` + `supabase start` job, proven with a manual/canary run before it gates merges | Documented 2026-08-21 — not yet attempted against a real GitHub-hosted runner |
| AGENTS.md guardrails for tests, uploads, auth/API surfaces, account deletion, n8n, and secrets-in-output | **Implemented** | Low | — | `AGENTS.md` §34 (added 2026-08-21) | Keep §34 in sync whenever a referenced control's status changes here | Verified 2026-08-21: section read back after edit |

### DB tests in CI — investigation result

**Decision: left out of CI in this phase.** The five safety conditions given for this task can be satisfied in principle, but the sixth — *"the configuration is reliable on GitHub-hosted runners"* — cannot be proven from this environment:

- Running `tests/db` requires the **full local Supabase stack** (Postgres, GoTrue, PostgREST, Storage — this repo's tests exercise real RLS through real per-user sessions, not mocks; see `tests/db/helpers.mjs`). Starting that stack means running `supabase start`, which pulls and runs several Docker containers.
- GitHub-hosted `ubuntu-latest` runners have Docker available, and the official `supabase/setup-cli` action plus `supabase start` is a documented, commonly-used pattern — but its reliability depends on image-pull latency, the standard runner's 2-core/7GB resource ceiling, and known community reports of intermittent slowness/flakiness from heavier auxiliary services (analytics/logflare, edge-runtime, imgproxy) that this project's tests never actually need.
- Proving reliability requires an actual run against a GitHub-hosted runner — which this controlled, no-push task cannot do (pushing/triggering Actions is out of scope until you approve it). Per your instruction not to improvise past that point, DB tests stay out of CI until reliability is demonstrated with a real run.

**Safest path forward (Phase 2+, not implemented now):**
1. Add a **separate**, initially **non-required** CI job (`db-tests`), so a flaky run never blocks merges while it's being proven out.
2. Use `supabase/setup-cli@v1` pinned to a specific version, then `supabase start` (excluding services this project's tests don't use, if the installed CLI version supports selective startup — e.g. `--exclude analytics,imgproxy,edge-runtime`) to keep the stack minimal and faster to boot.
3. Read connection details from `supabase status -o env` **within the job** (never committed) and export them as job-scoped env vars for `npm run test:db` — no secret is ever stored in the repo or in GitHub Secrets, since these are ephemeral local-only credentials generated fresh per run.
4. Run `npm run test:db`, then `supabase stop` (the runner's teardown would also discard everything regardless).
5. Watch it run green on several real PRs before promoting `db-tests` to a required check.

---

## Full findings (from the 2026-08-21 audit) — unchanged this phase

Everything below is carried forward from the audit as-is; Phase 1 intentionally did not touch rate limiting, security headers, auth behavior, migrations, RLS policies, or n8n. Timing labels that previously read "before merging this auth branch" have been updated to **"before starting Automation 2"**, since the auth branch this label referred to is the one being finished in this very change.

### Security

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| RLS enabled and narrowly scoped per table | Implemented | Low | — | `supabase/migrations/*.sql` (cvs, profiles, matches, applications, jobs, notifications, audit_events, automation_tasks, analysis_feedback) | Re-check the live project once RLS is verifiable (see DB-01) | Verified 2026-08-21 via migration source only |
| App-level rate limiting on abuse-sensitive routes | Not Implemented | High | Before deployment | `grep -r "rate.?limit" src/` — no matches | Add a shared, production-safe rate-limit store (Phase 2 — explicitly out of scope for Phase 1) | Verified 2026-08-21 |
| Security headers (CSP/HSTS/etc.) | Not Implemented | High | Before deployment | `next.config.ts` has no `headers()` function | Add a `headers()` block (Phase 2 — explicitly out of scope for Phase 1) | Verified 2026-08-21 |
| Password policy consistency (client vs. Supabase Auth) | Partially Implemented | Medium | Before deployment | Client enforces 8 chars; `supabase/config.toml` (local dev only) still sets `minimum_password_length = 6`, production dashboard value unverified separately | Raise the Auth-server minimum to match the client rule, in both `supabase/config.toml` and the hosted project's dashboard | Verified 2026-08-21 (local config only) |
| `profiles.role` not client-writable | Implemented | Low | — | `20260809090020_add_profiles_role.sql` — column-level GRANT excludes `role` | None | Verified 2026-08-21 |
| Live-project RLS matches migration source | Cannot Verify | Medium | Before deployment | Requires production Supabase dashboard access | Confirm via Supabase dashboard → Auth → Policies before launch | Not verifiable from this environment |

### File handling

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Client/Storage-bucket/RPC MIME + size checks on CV upload | Implemented | Low | — | `onboarding/upload-cv/page.tsx`; `20260811090000_restrict_cv_to_pdf.sql` | None | Verified 2026-08-21 |
| Server-side byte-level (magic-number) file validation | Not Implemented | Medium | Soon after launch | Only MIME-type/extension checks found at every layer | Add a PDF header/magic-number check (AGENTS.md §34 now requires this eventually) | Verified 2026-08-21 |

### API protection

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Explicit allowlisted fields on every write | Implemented | Low | — | `parseBody`/`parseRequestBody` guards in every `src/app/api/**/route.ts` | None | Verified 2026-08-21 |
| Minimal API responses (no unnecessary `select("*")`) | Partially Implemented | Low | Soon after launch | `cv_analyses` reads use `select("*")` in `src/lib/cvAnalysis/review.ts` and the dashboard, shipping `extracted_text` to the client | Select only the columns each view actually renders | Verified 2026-08-21 |

### Rate limiting and abuse prevention

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Auth endpoints (login/signup/OAuth/reset) | Partially Implemented | Medium | Before deployment | Supabase built-in `[auth.rate_limit]` only; production dashboard values unverified | Confirm hosted-project values before launch | Verified 2026-08-21 (local config only) |
| App routes (feedback, profile updates, checkout, CV upload/replace, AI-task creation) | Not Implemented | High | Before deployment | `grep -r "rate.?limit" src/` — no matches | Phase 2 — explicitly out of scope for this change | Verified 2026-08-21 |
| Bot/CAPTCHA protection on public forms | Not Implemented | Medium | Before deployment | `[auth.captcha]` present but disabled in `supabase/config.toml` | Enable hCaptcha or Turnstile | Verified 2026-08-21 |

### Privacy and data retention

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Account deletion path | Not Implemented | High | Before deployment | No route/RPC found; `audit_events.event_type` reserves `account_data_deleted` but nothing implements it | Build a reviewed, cascading-delete-aware RPC + UI. **Deployment blocker per AGENTS.md §34.** | Verified 2026-08-21 |
| Privacy policy published | Not Implemented | High | Before deployment | No `/privacy` route under `src/app` | Publish a privacy policy before any public/EU-facing launch. **Deployment blocker per AGENTS.md §34.** | Verified 2026-08-21 |

### Email and OAuth

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Production SMTP configured | Cannot Verify | Medium | Before deployment | Dashboard-side config, outside this repo | Confirm in Supabase dashboard → Auth → SMTP before launch | Not verifiable from this environment |
| OAuth redirect validation | Implemented | Low | — | `src/app/auth/callback/route.ts`; `src/lib/safeRedirect.ts` | Add a regression test to `tests/unit` | Verified 2026-08-21 |

### Payments

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| No fake payment success possible | Implemented | Low | — | `src/lib/payments/whish/provider.ts` throws `WhishNotConfiguredError` on every real operation | None until real Whish credentials/docs exist | Verified 2026-08-21 |

### n8n and AI automation

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Credentials referenced by name only, never hardcoded | Implemented | Low | — | `n8n-workflows/cv-analysis-worker.ts` — `newCredential(...)` references only | None | Verified 2026-08-21 |
| Idempotent worker retries | Implemented | Low | — | `Prefer: resolution=ignore-duplicates`; `FOR UPDATE SKIP LOCKED` in `claim_analysis_task` | None | Verified 2026-08-21 |
| Live workflow changes require explicit approval | Partially Implemented | Low | — | Documented in AGENTS.md §34; no automated/technical enforcement exists (e.g., no CI gate or access control blocking a `publish_workflow`/import action) | Continue requiring sign-off before any `publish_workflow`/import to the running instance; consider a technical control (e.g., restricted n8n publish credentials) if the process rule alone proves insufficient | Verified 2026-08-21 — documentation only, not a technical control |

### CI/CD

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Tests run in CI | Partially Implemented | Medium | Before starting Automation 2 | `.github/workflows/ci.yml` — unit + workflow wired this phase; DB tests intentionally deferred (see above) | Land the DB-in-CI job once proven reliable | Verified 2026-08-21 |
| Branch protection on `main` | Cannot Verify | Medium | Before starting Automation 2 | No `gh` CLI/API access from this environment | Confirm required-checks list includes `quality-checks` (and later `db-tests`) via GitHub repo settings | Not verifiable from this environment |

### Testing

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Full suite wired to one command | Implemented | Low | — | `package.json` `test`/`test:unit`/`test:workflow`/`test:db` scripts | Add new test files to the relevant existing directory — no script changes needed | Verified 2026-08-21: `npm test` run locally, 344/344 passing |

### Monitoring and incident response

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Error tracking / alerting service | Not Implemented | High | Before deployment | Only `console.error`, no external sink | Wire existing safe log call sites into an error-tracking service | Verified 2026-08-21 |

### Backups and disaster recovery

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Point-in-time recovery enabled and restore tested | Cannot Verify | High | Before deployment | Dashboard-side, no repo evidence | Confirm in Supabase dashboard → Database → Backups; run one restore drill | Not verifiable from this environment |

### Performance and scalability

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Load-tested worker throughput | Cannot Verify | Medium | Later at scale | No load-test evidence exists | Run k6/Artillery against a staging environment once traffic is real | Not verifiable from this environment |

### Deployment and rollback

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Documented migration rollback procedure | Not Implemented | Medium | Before deployment | Forward-only migrations; no down-migration scripts | Document a rollback/forward-fix procedure per AGENTS.md §33 | Verified 2026-08-21 |

### Documentation

| Finding | Current status | Severity | Required timing | Concrete evidence | Recommended remediation | Verification status |
|---|---|---|---|---|---|---|
| Incident-response runbook | Not Implemented | Medium | Before deployment | No runbook file found | Write one before public launch | Verified 2026-08-21 |

---

*Last full audit: 2026-08-21. This file supersedes any severity/timing labels stated in prior chat-only reports — if the two ever disagree, this file is correct.*
