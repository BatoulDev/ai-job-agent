<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Job Agent — Project Engineering Rules

These rules apply to every code change in this repository.

## 1. Project stack

- Use Next.js App Router, React, TypeScript, and Tailwind CSS.
- Follow the exact package versions installed in this repository.
- Before using a Next.js API, inspect the installed Next.js version and its relevant local documentation.
- Do not introduce a new library when the existing stack can solve the problem safely.
- Keep changes focused and avoid unrelated refactoring.
- Preserve the existing architecture and conventions unless a change is clearly justified.
- Inspect the relevant files before editing them.

## 2. TypeScript

- Keep TypeScript strict.
- Do not use `any`, `@ts-ignore`, or `@ts-expect-error` to hide problems.
- Do not weaken TypeScript configuration to make errors disappear.
- Define clear types for component props, API inputs, API responses, database records, and returned data.
- Validate untrusted data at runtime before using it.
- Handle nullable and optional values explicitly.
- Fix the root cause of type errors instead of suppressing them.
- Avoid unsafe type assertions unless the value has been validated.

## 3. Next.js and React

- Follow App Router conventions.
- Use Server Components by default.
- Add `"use client"` only when browser APIs, React state, effects, or client event handlers are required.
- Keep client component boundaries as small as possible.
- Use `next/link` for internal navigation.
- Use `next/image` for suitable local and remote images.
- Do not use `window.location` for normal internal navigation.
- Do not create infinite re-render loops.
- Keep `useEffect` dependencies accurate and stable.
- Clean up timers, subscriptions, observers, and event listeners.
- Prevent hydration mismatches between server and client rendering.
- Do not access `window`, `document`, `localStorage`, or other browser-only APIs in Server Components.
- Do not disable React or Next.js safeguards to hide errors.
- Handle loading, error, empty, and success states appropriately.

## 4. Routing and navigation

- Internal navigation must work from every route.
- Homepage section links must use `/#section-id`, not only `#section-id`, when they may be clicked from another route.
- Preserve browser Back and Forward behavior.
- Account for the fixed navbar when scrolling to page sections.
- Test navigation from the homepage and nested routes.
- Do not block navigation accidentally with `preventDefault`.
- Clicking the brand logo must navigate to `/`.
- Use valid routes and avoid duplicating routing logic.
- Verify desktop and mobile navigation after relevant changes.

## 5. Styling and responsive design

- Use Tailwind CSS consistently.
- Preserve the existing visual system and brand identity.
- Use these project colors consistently:
  - Primary: `#1E3A8A`
  - Accent: `#06B6D4`
  - Success: `#10B981`
  - Background: `#F8FAFC`
  - Text: `#0F172A`
  - Muted: `#64748B`
- Avoid unnecessary inline styles.
- Avoid unexplained arbitrary Tailwind values.
- Avoid duplicated class patterns when a reusable component or helper is appropriate.
- Keep layouts responsive for mobile, tablet, laptop, and desktop.
- Maintain accessible color contrast, keyboard navigation, visible focus states, and semantic HTML.
- Buttons that perform actions must be actual buttons.
- Navigation elements must be links.
- Do not change the visual design unless the task requires it.

## 6. Data, API, authentication, and security

- Never expose secrets or private API keys in client-side code.
- Keep sensitive values in environment variables.
- Do not commit real environment secrets.
- Validate and sanitize external input.
- Enforce authentication and authorization on the server.
- Do not trust client-provided user IDs, plan names, prices, match scores, roles, or permissions.
- Handle API and database failures with safe and useful error states.
- Never log CV contents, passwords, access tokens, API keys, or sensitive personal information.
- Follow least-privilege principles.
- Verify that users can only access and modify their own private data.
- Do not expose internal error details to end users.

## 7. AI Job Agent product rules

- Never scrape LinkedIn.
- Never automatically apply through LinkedIn.
- LinkedIn jobs may only provide the user with the original job link and prepared application materials.
- Prefer safe sources such as company career pages, public job boards, Greenhouse, Lever, Workable, Ashby, and jobs with public application emails.
- Nothing may be sent, submitted, or applied to without explicit user approval.
- The user must be able to approve or reject before any external action.
- Prioritize high-quality job matches over match quantity.
- Match scores must have understandable explanations.
- Do not invent job details, qualifications, company information, or application status.
- Keep the MVP focused on:
  - Landing page
  - Signup and login
  - CV upload
  - User preferences
  - Admin job entry
  - AI CV parsing
  - Job matching
  - Cover-letter generation
  - Approve and reject flow
  - Simple dashboard
- Avoid adding features outside the requested scope without approval.
- Preserve a professional, trustworthy, young, and AI-focused product experience.

## 8. Performance and caching

- Avoid unnecessary client components.
- Avoid unnecessary re-renders, effects, state, and network requests.
- Do not fetch the same data repeatedly without a valid reason.
- Use Next.js caching and revalidation intentionally.
- Do not cache user-specific, authenticated, or sensitive data publicly.
- Document important caching decisions when behavior is not obvious.
- Do not use deletion of `.next` as a permanent fix.
- Investigate whether a problem comes from application code, caching, compilation, Fast Refresh, or the development server.
- Avoid importing large libraries into client bundles when a smaller existing solution is available.
- Use code splitting and lazy loading only when they provide a real benefit.
- Avoid premature optimization, but fix measured or clearly demonstrated performance problems.
- Do not sacrifice correctness for small performance gains.

## 9. Development-server reliability

When the development server freezes, stops responding, or behaves inconsistently:

1. Inspect the terminal output.
2. Inspect browser-console errors.
3. Inspect failed or pending network requests.
4. Check whether the route is compiling.
5. Check for infinite React renders or effect loops.
6. Check for duplicate development servers.
7. Check which process owns the expected port.
8. Check for runtime, hydration, and module errors.
9. Identify the root cause before restarting the server.

- Restarting the server may be used for confirmation, but it is not a complete diagnosis.
- Do not repeatedly terminate processes without identifying what they are.
- Do not permanently solve problems by changing ports unnecessarily.
- Do not suppress server warnings without understanding them.

## 10. Debugging workflow

When diagnosing a bug:

1. Reproduce the exact problem.
2. Record the failing route, action, state, and visible behavior.
3. Inspect terminal, browser console, network requests, and runtime errors.
4. Trace the relevant code path.
5. Identify the root cause before editing.
6. Make the smallest safe fix.
7. Test the original failing flow.
8. Test related flows for regressions.
9. Run static validation and the production build.
10. Report the root cause and verification evidence.

- Do not guess.
- Do not apply random changes until something appears to work.
- Do not suppress errors or warnings.
- Do not hide problems with broad `try/catch` blocks.
- Do not claim that clearing caches fixed the root cause unless stale generated files were proven to be responsible.
- Do not claim a bug is fixed based only on reading the code.

## 11. Required validation

After every meaningful code change, inspect `package.json` and run the validation scripts supported by the project.

At minimum, verify:

- ESLint
- TypeScript type checking
- Relevant automated tests
- Next.js production build

Use the repository's real scripts. Typical commands may include:

- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`

Do not assume a command exists. Check `package.json` first.

For changes affecting user flows, also test the relevant flow manually or with an end-to-end test.

Do not claim that work is complete unless:

- Relevant validation commands passed.
- The original issue or requested behavior was tested.
- Related critical flows were checked.
- No new relevant errors or warnings remain.

If a command cannot run, explain exactly why.

Never report a command as passing unless it was actually executed successfully.

Do not hide failed checks by changing configuration, removing tests, weakening rules, or excluding files.

## 12. Testing expectations

- Test behavior, not implementation details.
- Add or update a regression test for bug fixes when practical.
- Test success, loading, empty, and failure states when relevant.
- Mock external services in automated tests when real calls are unsafe or unreliable.
- Never send a real job application, email, or external action during automated testing.

Important flows include:

- Homepage navigation
- Cross-route navbar links
- Mobile navigation
- Signup and login
- CV upload and parsing
- User preferences
- Job matching
- Match-score display
- Cover-letter generation
- Approve and reject actions
- Dashboard states
- Error and empty states
- Browser Back and Forward navigation
- Direct route visits
- Authenticated and unauthenticated access

## 13. Safe change process

Before editing:

1. Read the relevant files.
2. Understand the existing behavior.
3. Inspect related types and tests.
4. Check for uncommitted user changes.
5. Plan the smallest complete change.

While editing:

- Preserve unrelated user changes.
- Avoid rewriting entire files for a small fix.
- Avoid creating duplicate components or utilities.
- Keep naming clear and consistent.
- Do not leave dead code, commented-out experiments, or temporary debugging logs.
- Do not silently change product behavior outside the request.

After editing:

1. Review the diff.
2. Remove temporary debugging code.
3. Run required validation.
4. Test the relevant user flow.
5. Report exactly what changed.

## 14. Completion report

After completing a coding task, report:

- Root cause, when the task was a bug.
- Implementation summary.
- Files changed.
- Validation commands actually executed.
- Real validation results.
- Manual or automated flows tested.
- Remaining risks, warnings, or untested areas.

Never say "fixed," "working," "complete," or "all tests passed" without verification.

If validation fails, clearly state that the task is not fully verified and include the failure.

## 15. Instruction priority

- Follow these project rules for every task.
- Follow the existing generated Next.js version rules.
- If an instruction conflicts with the installed framework version, inspect the local version documentation and use the version-correct implementation.
- If two project instructions conflict, stop and explain the conflict instead of silently choosing.
- Do not modify AGENTS.md or CLAUDE.md during normal feature work unless the user explicitly asks.

## 16. Maintainability and extensibility

- Write code that can safely support future features without requiring large rewrites.
- Prefer clear, simple, modular architecture over clever abstractions.
- Keep business logic separate from presentation components.
- Keep database access, external API calls, validation, and UI logic in appropriate separate layers.
- Use small, focused components and functions with one clear responsibility.
- Extract shared code only when it is genuinely reused or represents an important domain concept.
- Avoid both duplicated logic and premature abstraction.
- Do not create oversized components, route handlers, services, or utility files.
- Use descriptive names that communicate business meaning.
- Keep public interfaces small and predictable.
- Prefer composition over complex inheritance or tightly coupled components.
- New features should integrate through existing stable interfaces where possible.
- Do not make one feature depend unnecessarily on the internal implementation of another feature.
- Document important architectural decisions when the reason is not obvious.
- Preserve backward compatibility unless a breaking change is explicitly approved.
- When changing shared code, identify and test all known consumers.

## 17. Feature design requirements

Before implementing a significant new feature:

1. Identify the user flow and acceptance criteria.
2. Identify affected routes, components, APIs, database tables, permissions, and tests.
3. Identify failure states and edge cases.
4. Check whether an existing component, type, helper, or service should be reused.
5. Plan how the feature can be extended later without unnecessary complexity.
6. Confirm that the feature fits the approved MVP scope.
7. Implement the smallest complete vertical slice.
8. Test its integration with existing features.

- Do not start coding a significant feature without understanding its full data flow.
- Avoid temporary implementations that silently become production dependencies.
- Use feature flags for incomplete or risky features when appropriate.
- Do not expose incomplete features to production users.
- Database changes must be made through reviewed, reversible migrations.
- Do not perform destructive schema changes without an explicit migration and rollback plan.

## 18. API and service resilience

- External API calls must use appropriate timeouts.
- Handle rate limits, temporary failures, invalid responses, and unavailable services.
- Use retries only for safe and retryable operations.
- Use limited retries with backoff; never create infinite retry loops.
- Avoid retrying non-idempotent actions unless duplicate execution is safely prevented.
- Prevent duplicate emails, applications, payments, AI requests, and database writes.
- Design important external actions to be idempotent when possible.
- Validate external API responses instead of trusting their shape.
- Show users a safe error state when an external service is unavailable.
- Do not allow one failed third-party service to crash an entire page when a partial fallback is possible.
- Never silently report an external action as successful when its result is unknown.

## 19. Error handling and observability

- Use appropriate route-level and component-level error boundaries.
- Provide clear user-facing error messages without exposing internal implementation details.
- Log actionable technical context on the server while excluding sensitive data.
- Distinguish validation errors, authentication errors, permission errors, service failures, and unexpected errors.
- Do not swallow exceptions.
- Do not use empty catch blocks.
- Do not treat expected user errors as server crashes.
- Include request or operation identifiers for important asynchronous flows when appropriate.
- Production-critical flows must be diagnosable from logs without exposing CV data or personal information.
- Add monitoring and error tracking before public production launch.
- Add health checks for critical production services when supported by the deployment platform.

## 20. Database reliability

- Use Supabase and PostgreSQL according to the project architecture.
- Enforce Row Level Security for private user data.
- Review RLS policies whenever a table or access pattern changes.
- Use database constraints for important invariants instead of relying only on the UI.
- Add indexes for frequently queried columns when justified by real query patterns.
- Avoid N+1 queries and unnecessary database round trips.
- Select only the data required by the current operation.
- Use transactions for multi-step writes that must succeed or fail together.
- Make migrations reversible when practical.
- Back up production data before risky migrations.
- Test migrations against a non-production environment before production.
- Never test destructive database operations against real production user data.

## 21. Environment separation

- Keep development, testing, preview, and production environments separate.
- Never use production credentials in local development or automated tests.
- Provide a safe `.env.example` containing variable names but no secret values.
- Validate required environment variables at startup or build time.
- Fail with a clear configuration error when required variables are missing.
- Do not silently use insecure fallback secrets.
- Document whether each variable is server-only or safe for the browser.
- Only variables intentionally exposed to the browser may use the `NEXT_PUBLIC_` prefix.
- Confirm that preview deployments do not send real emails or perform real job applications.

## 22. Production readiness

Before stating that the project is ready for deployment, verify:

- The production build succeeds.
- ESLint and strict TypeScript checks succeed.
- Automated tests succeed.
- Critical end-to-end user flows succeed.
- Authentication and authorization are enforced server-side.
- Supabase Row Level Security is enabled and reviewed.
- Environment variables are documented and validated.
- No secrets exist in source code or client bundles.
- Error, loading, empty, and unavailable-service states exist.
- External API failures and timeouts are handled.
- Database migrations have been tested.
- Responsive behavior has been tested.
- Accessibility basics have been checked.
- Important metadata, page titles, and production URLs are configured.
- Production logging and error monitoring are configured.
- Email and application actions still require explicit user approval.
- No demo authentication, mock data, test bypass, debug route, or development-only behavior remains enabled in production.
- Preview and production services use the correct credentials.
- A rollback path exists for the deployment and database migration.

Do not declare the application "production ready" based only on a successful build.

## 23. Deployment safety

Before deployment:

1. Review the complete diff.
2. Confirm the deployment target and environment.
3. Run the full validation suite.
4. Run critical end-to-end flows in a production-like environment.
5. Verify environment variables without exposing their values.
6. Verify database migrations and rollback steps.
7. Confirm that no real email or external application is triggered during testing.
8. Record known limitations and remaining risks.

After deployment:

1. Verify the homepage and critical routes.
2. Verify authentication.
3. Verify one safe non-destructive version of each critical flow.
4. Inspect production logs and error monitoring.
5. Confirm that static assets, APIs, and database connections work.
6. Roll back if a critical failure is discovered.

- Never deploy while required checks are failing.
- Never deploy unreviewed destructive migrations.
- Never use a production deployment as the first test of a feature.
- Never claim deployment success without checking the deployed application.

## 24. Dependency management

- Avoid unnecessary dependencies.
- Inspect package compatibility with the installed Next.js and React versions before installation.
- Prefer maintained and well-documented packages.
- Do not install multiple libraries that solve the same problem.
- Pin or lock dependency versions through the existing package-lock.json.
- Review security and breaking-change risks before major upgrades.
- Make dependency upgrades separately from unrelated feature work when practical.
- Run the complete validation suite after dependency changes.
- Do not remove or upgrade a package without checking all usages.

## 25. Definition of done

A feature or fix is done only when:

- The requested behavior is implemented.
- The implementation is clean, typed, focused, and maintainable.
- Existing features continue to work.
- Error and edge states are handled.
- Security and authorization were considered.
- Relevant tests were added or updated.
- Lint, type checking, tests, and production build passed.
- The relevant flow was verified.
- Documentation or environment examples were updated when needed.
- No temporary debug code, unsafe bypass, or incomplete placeholder remains.
- Remaining limitations and risks are reported honestly.
