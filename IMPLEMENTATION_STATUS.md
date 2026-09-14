# Implementation status

Updated 2026-09-14. The repository contains a working implementation, but the complete beta acceptance plan has not yet been validated. Do not represent it as production-ready.

## Implemented

- pnpm monorepo, Next.js dashboard and three-panel visual builder, drag-to-reorder workflow steps, remote Chromium screencast with authenticated single-use sessions, interaction/selection modes and selection through nested iframes.
- Better Auth verified-email signup, password reset, private tenant-scoped resources, hashed API keys, administrator suspension and configurable monthly quotas.
- Versioned contracts and immutable scraper versions; input interpolation, collection/detail extraction, next-page/infinite-scroll pagination, typed and RE2 regex transforms, JSON results, repair drafts, selector replacement and explicit template upgrade diffs.
- BullMQ runs, usage reservations, cancellation, failure artifacts, a downloadable scraper that runs on the user's computer with their own browser profile, encrypted domain-bound secrets and seven-day browser sessions.
- Marketplace submission validation, administrator review, private pinned installation, metadata, reports, domain blocks and audit records.
- Sandboxed non-root Chromium, restricted Docker egress proxy, public-IP/DNS validation, signed bounded-retry webhooks with PostgreSQL delivery records and queue reconciliation, retention, metrics, backup/restore scripts.
- Four Drizzle migrations (18 tables), Docker Compose and CI with PostgreSQL, Redis and Chromium installation.

## Verified locally

- `pnpm typecheck`: passed.
- `pnpm build`: passed; production Next.js pages and API routes compile.
- `TEST_DATABASE_URL=... pnpm test`: 90 tests passed across eleven files using PostgreSQL 18.6, Redis 8.10.1 and real Chromium (2026-09-14, after the changes in `CHANGELOG.md`). Without `TEST_DATABASE_URL` the three integration files are skipped, which is not a full result.
- Fault injection (2026-09-14):
  - Webhook signatures checked the way receivers are told to check them; real BullMQ retries ending delivered or failed; refused private and non-HTTPS destinations; revoked orphan deliveries; outbox reconciliation of pending deliveries and queued runs.
  - Crashed-run usage settlement; the 429 quota refusal; result and screenshot retention.
  - Egress proxy address pinning against a rebinding DNS resolver.
- Controlled fixtures in real Chromium (2026-09-14):
  - HTTP 429 and CAPTCHA pages end as blocked without retries.
  - Duplicate rows are removed across pages, by whole row or by key.
  - Pagination that replaces results in place collects every page.
  - Items and selections work two iframes deep.
- Builder UI clicked through in Chromium against the running web app and worker (2026-09-13): `books.toscrape.com` 18 of 18 checks (error handling, automatic collection, Preview, Run with 20 rows, reconnect and disconnect); live `www.amazon.in` search 7 of 7 (collection 16 of 16, Preview, Run with 16 rows). Chromium only.
- Next-page pagination and detail pages through the builder UI on `books.toscrape.com` (2026-09-14): 11 of 11 checks; a run followed the next link for 40 rows from 2 pages, and a run opened each item's detail page for 3 rows with availability.
- Worker restart with an open browser session (2026-09-14): a graceful reload settled usage at 4.9 s and a SIGKILL followed by a new start settled it at 13.8 s, with no leases left in either case.
- Sign-in, sign-up and password reset forms in Chromium (2026-09-14): 27 of 27 checks covering client validation, Better Auth error codes, rate-limit and network messages, double-submit protection, and verification and reset link outcomes. Email-sending endpoints were mocked; sign-in used real temporary accounts.
- Dashboard in Chromium (2026-09-14): 44 of 44 checks across scrapers, run history and result export, API keys, credentials, webhooks, marketplace report and install, review queue, abuse reports, users, domain policies and tab navigation, with no browser console errors. `app/error.tsx` confirmed with a temporary crashing route.
- Editor features through the builder UI on `quotes.toscrape.com` (2026-09-14): 26 of 26 checks in two runs. They covered a login recorded live with a stored credential and replayed, saved login session reuse and revoke, a dropdown search with Choose option, infinite scroll (30 rows from 3 pages), and a page rendering after about 14 seconds with Wait for.
- Template lifecycle through the UI with two accounts on `books.toscrape.com` (2026-09-14): 16 of 16 checks.
  - Submit, approve and install version 1.
  - Up-to-date message, then submit and approve version 2, with one marketplace card.
  - Diff review and apply, then a run with the new field.
  - Broken-selector failure shown in Run history, Repair / edit, and a repaired run.
- Tests include signup verification/reset, tenant separation, API key ownership, immutable versions, idempotency, cancellation, marketplace approval/install, credential handling, URL security, field conversion, portable export, dynamic search/detail extraction, selector fallbacks, HTTP 403 handling, and pagination ending without a next button.
- All four Drizzle migrations applied to the isolated local test database.
- Docker worker image built. A non-root container with all capabilities dropped, no-new-privileges, the checked-in seccomp profile and `chromiumSandbox: true` rendered a page successfully.
- Docker Compose on Docker Desktop (2026-09-14): 25 of 25 smoke checks passed on images built from the restructured Dockerfile. They covered HTTPS, auth, proxied runs, webhook delivery attempts, network boundaries, concurrency, cancellation, restart recovery and the editor over WSS (see `CHANGELOG.md`). A code-only rebuild took 65 s with no downloads.
- Dashboard screenshot reviewed locally at `artifacts/workspace.png` (ignored artifact).

## Remaining acceptance work

1. Visual builder in Chromium is verified through these features: selection, collections, Preview, Run, next-page and detail pages, recorded Fill/Click/Choose option steps, stored credentials and saved sessions, infinite scroll, delayed pages, and the two-account template lifecycle through version-2 repair. Dialogs are native modal dialogs that keep keyboard focus inside. Safari and Firefox are not verified, and those checks are not planned: the owner chose not to download those browsers.
2. Controlled fixtures cover 429 and CAPTCHA blocks, duplicate rows across pages, delayed single-page-app pagination and nested iframes. Not yet covered:
   - Target login and session restoration are verified only against the public `quotes.toscrape.com` sandbox.
   - Live and cross-origin frames are not verified.
   - Runs do not report skipped duplicate rows or a row count far below earlier runs; those diagnostics do not exist.
3. Fault handling is covered in two places:
   - In process: webhook signatures, retries and outbox recovery, crashed-run settlement, quota refusal, retention, and egress pinning against DNS rebinding.
   - In Compose: webhook delivery over HTTPS, proxy refusals, Chromium routed through the proxy, and restart recovery.

   Not yet covered:
   - Delivery to a receiver that accepts it; the Compose check reached example.com, which rejected it.
   - BullMQ re-running a job after its worker process was killed.
4. Compose starts and passes the smoke test locally on Docker Desktop (arm64) with a local certificate. Repeat it on the Linux VPS with the real domain, certificate and email.
5. Measure two concurrent runs on the intended VPS, including browser memory reserve, queue/stream latency and cancellation. Actual click-driven navigation accounting and adaptive SPA pagination need further acceptance coverage.
6. Configure the operator's domain, TLS, email sender, keys and off-host backup destination. Fill in the operator details in `apps/web/components/legal.tsx` and have the draft Terms, Privacy Policy and Acceptable Use Policy reviewed. Rehearse backup restoration into a new database and perform one owned/authorized live-site smoke test over deployed HTTPS/WSS.
7. Startup lease cleanup and crash usage settlement assume a single worker process; key leases by worker id before running more than one. A crashed session is charged until the worker starts again, capped at its reservation.

## Roadmap (2026-09-14)

Done: dashboard completeness and reliability; editor features and the template lifecycle; worker fault recovery and coverage; local Docker Compose verification; dialog focus, nested frames and test cleanup; single-page-app pagination with block and duplicate fixtures; draft Terms, Privacy and Acceptable Use pages; local runs with the user's own browser profile (see `CHANGELOG.md`).

Next, in order:

1. Decide whether runs should report diagnostics: duplicate rows skipped, and a row count far below the previous run. Neither exists yet.
2. Operator only: VPS capacity measurement, domain and TLS, a Resend sending domain, off-host backups with a restore rehearsal, a live HTTPS/WSS smoke test, and legal review of the draft Terms, Privacy Policy and Acceptable Use Policy.

## Local continuation

`CHANGELOG.md` records each change with its verification and open issues.

The isolated test services are `scrapepilot-test-postgres` at localhost:55432 and `scrapepilot-test-redis` at localhost:56379. Their credentials are test-only; use the test database URL from the session or configure a new database. No production credentials or default login account have been created. Root `.env` variables must be exported for the worker and migration commands.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Set `TEST_DATABASE_URL` to include authentication/API integration tests; without it those suites skip. Install Chromium with `pnpm --filter @scrapepilot/scraper-engine exec playwright install chromium`. CI sets up the required services.
