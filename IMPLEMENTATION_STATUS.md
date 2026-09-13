# Implementation status

Updated 2026-09-13. The repository contains a working implementation, but the complete beta acceptance plan has not yet been validated. Do not represent it as production-ready.

## Implemented

- pnpm monorepo, Next.js dashboard and three-panel visual builder, drag-to-reorder workflow steps, remote Chromium screencast with authenticated single-use sessions, interaction/selection modes and iframe selector preservation.
- Better Auth verified-email signup, password reset, private tenant-scoped resources, hashed API keys, administrator suspension and configurable monthly quotas.
- Versioned contracts and immutable scraper versions; input interpolation, collection/detail extraction, next-page/infinite-scroll pagination, typed and RE2 regex transforms, JSON results, repair drafts, selector replacement and explicit template upgrade diffs.
- BullMQ runs, usage reservations, cancellation, failure artifacts, portable engine export, encrypted domain-bound secrets and seven-day browser sessions.
- Marketplace submission validation, administrator review, private pinned installation, metadata, reports, domain blocks and audit records.
- Sandboxed non-root Chromium, restricted Docker egress proxy, public-IP/DNS validation, signed bounded-retry webhooks with PostgreSQL delivery records and queue reconciliation, retention, metrics, backup/restore scripts.
- Four Drizzle migrations (18 tables), Docker Compose and CI with PostgreSQL, Redis and Chromium installation.

## Verified locally

- `pnpm typecheck`: passed.
- `pnpm build`: passed; production Next.js pages and API routes compile.
- `TEST_DATABASE_URL=... pnpm test`: 58 tests passed across nine files using PostgreSQL 18.6, Redis 8.10.1 and real Chromium (2026-09-13, after the visual editor fixes in `CHANGELOG.md`).
- Builder UI clicked through in Chromium against the running web app and worker (2026-09-13): `books.toscrape.com` 18 of 18 checks (error handling, automatic collection, Preview, Run with 20 rows, reconnect and disconnect); live `www.amazon.in` search 7 of 7 (collection 16 of 16, Preview, Run with 16 rows). Chromium only.
- Tests include signup verification/reset, tenant separation, API key ownership, immutable versions, idempotency, cancellation, marketplace approval/install, credential handling, URL security, field conversion, portable export, dynamic search/detail extraction, selector fallbacks, HTTP 403 handling, and pagination ending without a next button.
- All four Drizzle migrations applied to the isolated local test database.
- Docker worker image built. A non-root container with all capabilities dropped, no-new-privileges, the checked-in seccomp profile and `chromiumSandbox: true` rendered a page successfully.
- Dashboard screenshot reviewed locally at `artifacts/workspace.png` (ignored artifact).

## Remaining acceptance work

1. Complete the visual-builder journey in the UI: select → collection → fields → Preview → Run is verified by clicking through Chromium, but recording and replaying fill/click steps, pagination and detail pages, two-account template installation, version-2 repair, and Safari/Firefox are not.
2. Expand controlled fixtures for nested frames, infinite scroll, target login/session restoration, duplicate-row health diagnostics, changed row counts, 429/CAPTCHA blocks and delayed SPA pagination. First-level frame selection exists; nested-frame selection is not complete.
3. Add fault-injection integration coverage for webhook signatures/retries/outbox recovery, worker crashes, quota settlement, DNS rebinding through the running egress proxy and scheduled retention. The outbox implementation has type checking but not this integration coverage yet.
4. Verify full Docker Compose startup and the production web container after the final source changes; the successful container smoke test covered Chromium startup, not the entire deployment.
5. Measure two concurrent runs on the intended VPS, including browser memory reserve, queue/stream latency and cancellation. Actual click-driven navigation accounting and adaptive SPA pagination need further acceptance coverage.
6. Configure the operator's domain, TLS, email sender, keys and off-host backup destination. Rehearse backup restoration into a new database and perform one owned/authorized live-site smoke test over deployed HTTPS/WSS.
7. Settle interactive-session usage when the worker restarts: the shutdown handler quits Redis before closing WebSockets, leaving `browser-active` rows charged at the full reservation. Startup lease cleanup assumes a single worker process.

## Local continuation

`CHANGELOG.md` records each change with its verification and open issues.

The isolated test services are `scrapepilot-test-postgres` at localhost:55432 and `scrapepilot-test-redis` at localhost:56379. Their credentials are test-only; use the test database URL from the session or configure a new database. No production credentials or default login account have been created. Root `.env` variables must be exported for the worker and migration commands.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Set `TEST_DATABASE_URL` to include authentication/API integration tests; without it those suites skip. Install Chromium with `pnpm --filter @scrapepilot/scraper-engine exec playwright install chromium`. CI sets up the required services.
