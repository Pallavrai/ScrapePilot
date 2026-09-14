# Changelog

Newest first. Add an entry for every change: what changed and why, how it was verified, and what is still unverified. Read it with `IMPLEMENTATION_STATUS.md` before continuing work.

## 2026-09-14 (afternoon) — GitHub Actions: Chromium sandbox and duplicate runs

### Causes found

- **Every Verify run failed in `pnpm test`,** from the first run on 2026-09-13. Ubuntu 24.04 runners block the unprivileged user namespaces that Chromium's sandbox needs ("No usable sandbox!"). The engine launches Chromium with `chromiumSandbox: true`, so the browser tests could not start; the other 10 test files passed.
- **Duplicate runs:** the workflow ran on every push and every pull request, so a branch with an open pull request ran twice and sent two failure emails.
- **Deprecated actions:** `actions/checkout@v4` and `actions/setup-node@v4` target Node 20, which GitHub now warns about.

### Changed

- `.github/workflows/ci.yml`:
  - Allows unprivileged user namespaces on the runner (`kernel.apparmor_restrict_unprivileged_userns=0`) before the tests. The sandbox stays on in the code.
  - Runs on pushes to `main`, on pull requests and on demand.
  - A newer push to the same branch or pull request cancels the run in progress.
  - Uses `actions/checkout@v5` and `actions/setup-node@v5`.

### Still unverified

- The pull request's CI run with these changes.
- Dependabot's weekly npm update fails separately: inside Dependabot's environment, pnpm 12.4.1 cannot download its platform binary. No workflow change fixes that.

## 2026-09-14 (morning) — Run scrapers on your own computer

### Why

- Users want to run scrapers with their own internet connection and their own logins, for example to analyse their own accounts, instead of from ScrapePilot's servers.
- The downloaded TypeScript export could not run at all. The runner code was pasted after the bundled engine and redeclared `input`, so Node refused to parse the file. The test only searched the file's text.

### Changed

- `packages/scraper-engine/src/index.ts`: `execute` accepts a `profile`, which is a browser profile folder, optionally used with the installed Chrome. Such runs use a persistent browser that keeps logins made in it. Server runs are unchanged.
- `packages/scraper-engine/src/export.ts`: the runner is bundled with the engine through esbuild, so names cannot clash. The downloaded `scraper.mjs` works as follows:
  - `--login` opens a visible browser at the scraper's first page. The user signs in and presses Enter, and the login stays in `scrapepilot-profile`.
  - Runs reuse that profile in a visible window; `--headless` hides it.
  - Runs wait at least one second between page loads and stop at CAPTCHA and block responses, like server runs. Rows are saved to `results-<time>.json`.
  - `SCRAPER_CHANNEL=chrome` uses the installed Google Chrome, and `SCRAPER_PROFILE` moves the profile folder.
- Editor: the button is now "Download for your computer" and saves `scraper.mjs`; the API serves the same file name.
- Guide: a "Run on your computer" section.
- Privacy Policy: scrapers run on a user's computer send nothing back to ScrapePilot.
- Tests:
  - A login cookie persists between two runs that share a profile.
  - The export contains the local-run options and passes `node --check`.

### Verified

- `pnpm typecheck` passed; `TEST_DATABASE_URL=… pnpm test` passed 90 of 90; the export tests passed 2 of 2 after the bundling fix.
- A scraper exported for books.toscrape.com ran on this Mac, headless with a new profile, and succeeded with 5 rows saved to a results file.
- The editor's UI check of pagination and detail pages passed 11 of 11, confirming server runs after the engine change.
- The guide and Privacy Policy pages render the new text.

### Still unverified

- `--login` with a real person signing in, and `SCRAPER_CHANNEL=chrome`.
- Windows and Linux desktops.
- Sites that tie logins to a device or challenge automated browsers.
- Whether a given site's terms allow automation; the Acceptable Use Policy still applies.

## 2026-09-14 (early morning) — Draft Terms, Privacy Policy and Acceptable Use Policy

### Why

A market test needs terms of service, a privacy policy and an acceptable use policy. The app had none, and sign-up did not refer to any terms.

### Changed

- `apps/web/components/legal.tsx` (new):
  - Operator placeholders: legal name, address, contact email, effective date, governing law, courts, and hosting and backup providers.
  - A shared page layout that shows a draft notice while `draft` is `true`.
- `apps/web/app/terms/page.tsx`, `apps/web/app/privacy/page.tsx` and `apps/web/app/acceptable-use/page.tsx` (new), drafted from what the product actually does:
  - **Terms of Service:**
    - the free beta and its limits, account duties, and ownership of content with responsibility for scraped data
    - stored logins, the template license, API and webhooks
    - suspension, fees, disclaimers, a liability cap placeholder, indemnity, changes and governing law
  - **Privacy Policy:**
    - the data stored, including each sign-in session's IP address and user agent, and encrypted logins
    - retention: results 30 days; screenshots, saved sessions and idle sign-in sessions 7 days
    - service providers: hosting and backup placeholders, Resend, Google Fonts
    - sharing, security, user rights, sign-in-only cookies, and children
  - **Acceptable Use Policy:**
    - automate only sites you may; no bypassing CAPTCHAs or other access controls; limits on personal and sensitive data
    - template rules, including the robots.txt refusal
    - reporting abuse, domain blocks and enforcement
- `apps/web/components/auth-dialog.tsx`: sign-up states that creating an account accepts the Terms and Acceptable Use Policy and acknowledges the Privacy Policy. The links open in a new tab.
- `apps/web/components/workspace.tsx` and `apps/web/app/docs/page.tsx`: links to the three documents in the sidebar and the guide.
- `apps/web/app/globals.css`: styles for the legal pages and their links. The links override the global column layout of `nav`.
- `DEPLOYMENT.md`: step 7 — fill in the operator details, have the documents reviewed, and set `draft` to `false` before inviting users.

### Verified

- `pnpm typecheck` passed.
- `/terms`, `/privacy` and `/acceptable-use` return 200 with their titles and the draft notice.
- The Terms page and the sign-up consent line were checked in the Browser pane.
- The sign-in and sign-up UI checks passed 27 of 27.

### Still unverified

- **Legal review:** the documents are drafts, not legal advice, and they contain placeholders.
- **Operator choices:** hosting and backup providers, log and backup retention, and international transfers depend on the deployment.
- **Google Fonts:** pages load fonts from Google, which sends visitors' IP addresses there. Self-hosting the fonts would remove that disclosure.

## 2026-09-14 (overnight) — Single-page-app pagination, blocks and duplicates

### Causes found

- **Single-page-app pagination stopped after page 1:** after clicking Next, the engine waited only for `domcontentloaded`. A page that swaps its results in place has already reached that. The engine read the old results again, found only duplicates and ended pagination, so sites that fetch the next page instead of navigating returned only their first page.
- **Untested behavior:** there were no tests for HTTP 429 or CAPTCHA pages, or for removing duplicate rows.

### Changed

- `packages/scraper-engine/src/index.ts`:
  - Before clicking Next, the engine records the listed items' text; afterwards it waits up to 10 seconds for that text to change, then for the page to finish loading.
  - Pages that navigate behave as before. When nothing changes, pagination still ends, after the wait.
- `tests/browser.test.ts`:
  - HTTP 429 and a CAPTCHA page end as blocked, with a clear message and a single request.
  - Duplicate rows across pages are removed, by whole row or by `deduplicationKey`.
  - Pagination that replaces the results 1.5 seconds after Next collects both pages.

### Verified

- Before the fix, the new pagination test returned only "Product 1"; after it, both pages.
- `pnpm typecheck` passed. All 14 browser tests pass, including the existing next-page tests with real navigation.
- `TEST_DATABASE_URL=… pnpm test` passed 88 of 88. The UI check of next-page pagination and detail pages on books.toscrape.com passed 11 of 11.

### Still unverified

- Single-page-app pagination on live sites, and next pages that take longer than 10 seconds to appear.
- Runs report nothing about skipped duplicate rows or a row count far below earlier runs; those diagnostics do not exist.

## 2026-09-14 (late night) — Dialog focus, nested frames and test cleanup

### Causes found

- **Dialogs:**
  - Keyboard focus stayed on the page behind a dialog, and Tab moved through that page. Screen readers could still reach it.
  - Only three of eight dialogs closed with Escape.
  - The template update and definition dialogs had no dialog role or label.
- **Nested frames:** the picker looked only one iframe deep, and a locator could name only one frame. Content inside nested iframes could not be selected or extracted, and there were no frame tests at all.
- **Test data:** the API and authentication integration suites left their users and data in the database after every run. 64 `@example.test` users had accumulated.

### Changed

- `apps/web/components/modal.tsx` (new):
  - Dialogs are native `<dialog>` elements opened with `showModal()`, so the browser keeps focus inside and makes the page behind inert.
  - A dialog opens on its first form field, Escape closes it where closing is allowed, and focus returns to the control that opened it.
  - All eight dialogs use it: sign-in, password reset, the error screen (as an alert dialog), key reveal, run results, template report, template update and definition editing. The per-dialog Escape handlers are removed.
- `apps/web/app/globals.css`: `::backdrop` replaces the backdrop wrapper, and dialogs keep a margin at the viewport edges.
- `packages/contracts/src/index.ts`: a locator's `frame` is either one iframe selector or a chain of up to five, from the page inwards. Existing definitions stay valid.
- `apps/worker/src/selection.ts`: the picker descends through nested iframes under the pointer and records the chain.
- `packages/scraper-engine/src/index.ts`: one helper resolves the frame chain for fields, collections, Wait for and next-page links.
- `apps/worker/src/index.ts`: live Fill, Click and Choose option accept frame chains.
- Tests:
  - `tests/selection.test.ts` picks an element two iframes deep and resolves it through `locate`.
  - `tests/browser.test.ts` collects items two iframes deep in a run.
  - `tests/api.integration.test.ts` and `tests/auth.integration.test.ts` delete what they create.
- Prettier formatting on the dialog files.

### Verified

- `pnpm typecheck` passed; `TEST_DATABASE_URL=… pnpm test` passed 84 of 84.
- Dialog keyboard test in Chromium against the running app, 8 of 8:
  - focus lands on the first field
  - Tab and Shift+Tab never reach the page, and the page behind cannot be clicked
  - Escape closes the dialog and focus returns to Sign in
  - the reset-password dialog stays open after two Escapes
- The sign-in and reset-password dialogs were checked visually in the Browser pane.
- UI regression against the running app: auth forms 27 of 27, dashboard 44 of 44, template lifecycle 16 of 16, editor features on quotes.toscrape.com 24 of 24.
- The count of `@example.test` users stayed at 64 across the test suite and all of these UI tests, so nothing new was left behind.

### Still unverified

- Screen readers, Safari and Firefox.
- Nested frames on live sites, including cross-origin frames.
- The 64 fixture users left by earlier runs are still in the local database.

## 2026-09-14 (night) — Docker Compose verification

### Causes found

- **No runs in Compose:** the worker container is on an internal-only network, which cannot resolve public names. The worker still looked up each target's address itself before handing traffic to the egress proxy. Every run failed within a second with `getaddrinfo EAI_AGAIN`, and editor sessions could not open their first page.
- **Every rebuild downloaded everything again:** the Dockerfile copied the source before `pnpm install`, so any code change repeated the package install and the Chromium and system-library download. The worker image also held Chromium twice (4.59 GB).

### Changed

- `packages/scraper-engine/src/security.ts`: `assertPublicUrl` accepts `null` as the resolver to skip the DNS lookup. Scheme, credential, port and allowed-domain checks still apply.
- `packages/scraper-engine/src/index.ts` and `apps/worker/src/index.ts`: with `BROWSER_PROXY` set, run navigation, the request and WebSocket guards, and editor sessions skip that lookup. The egress proxy resolves, checks every answer and pins the address, and the worker has no other route out. Without a proxy (local development) the lookup still runs.
- `Dockerfile`:
  - Packages are fetched from the lockfile before the source is copied, then installed offline.
  - Chromium and its system libraries are installed in their own stage, keyed to the Playwright version pinned by the engine, and the worker copies the built app into it.
  - The web, webhooks and egress images do not contain Chromium.
- `tests/security.test.ts`: without DNS, undeclared domains and other ports are still refused.

### Verified

Docker Desktop (arm64), with a separate Compose project and a throwaway env file (generated keys, no email key).

- **Before the fix:** all 3 runs failed with `EAI_AGAIN`.
- **With the fix copied into the running worker:** 23 of 24 smoke checks passed.
  - **Startup and access:** migrations, all seven services, HTTPS through Caddy's local certificate authority, the HTTP redirect, and sign-up and sign-in.
  - **Runs:**
    - A run in the container's Chromium through the egress proxy returned 5 books.
    - Two runs on different sites ran at once, with a worker peak of 408 MiB.
    - A run was cancelled.
    - A worker restart mid-run failed that run with a clear message and charged 4.9 s.
  - **Webhooks:** the webhooks service delivered over HTTPS. example.com rejected it, so it retried and recorded the delivery as failed.
  - **Network boundaries:** the worker has no direct internet access. The proxy refused the metadata address, Postgres, Redis and port 22.
  - **Editor:** it connected over `wss://localhost/browser`, frames arrived, and Chromium ran with its sandbox on.
  - **The one failure:** the test clicked where the host's fonts put the title, which is not where the container draws it. The test now measures inside the container.
- **Restructured Dockerfile:** all four images built in 201 s; the worker image is 2.84 GB. A rebuild after a documentation-only change took 65 s and downloaded nothing.
- **Rebuilt images, nothing patched:** 25 of 25 smoke checks passed, including selecting a book title in the container browser (the test now measures its position inside the container). The throwaway Compose project and its volumes were removed afterwards.
- **Local checks:** `pnpm typecheck` passed; `TEST_DATABASE_URL=… pnpm test` passed 82 of 82.

### Still unverified

- A webhook receiver that accepts deliveries.
- A Linux VPS, a public domain certificate and real email.

## 2026-09-14 (evening) — Worker fault recovery and coverage

### Causes found

- **Interrupted runs:** a run left "running" by a crashed or restarted worker stayed that way for 20 minutes, then failed without settling usage. Its full reservation (up to 15 minutes) stayed charged, and no webhook delivery was recorded for it.
- **Stuck deliveries:** a delivery whose run no longer existed stayed "pending", so reconciliation requeued it indefinitely. Pending deliveries were also requeued in no particular order.
- **Untestable modules:** webhook delivery, reconciliation, retention and the egress proxy started queue consumers, timers or a fixed port when imported, so none of them could be tested. The plan's fault-injection coverage did not exist.

### Changed

- `apps/worker/src/delivery.ts` (new):
  - Webhook sending, signing and the delivery worker, moved from `webhooks.ts`. That file is now only the process entry point, and the Compose command is unchanged.
  - Deliveries whose webhook or run is gone are marked revoked.
- `apps/worker/src/maintenance.ts` (new):
  - Reconciliation and retention, moved out of `index.ts`.
  - `failInterruptedRuns`: in one statement, it fails lost runs, charges the time they ran (capped at the reservation) and records their webhook deliveries. The worker runs it for every running run at startup (the same single-worker assumption as for leases) and, during reconciliation, for runs that started more than 20 minutes ago.
  - Pending deliveries are requeued oldest first.
- `apps/worker/src/egress.ts`: exports the server; the port can be set with `EGRESS_PORT` (default 3002).
- `README.md`: local development needs a separate process for webhook delivery; `pnpm dev` and `pnpm worker` do not send webhooks.
- `tests/worker.integration.test.ts` (new, PostgreSQL and Redis):
  - Signatures pass the receiver check from the docs page, and a tampered body does not match. Event names follow the run status.
  - Real BullMQ retries: a receiver failing twice is delivered on the third attempt, and one that always fails is recorded as failed.
  - Non-HTTPS and private destinations are refused. Deliveries without a webhook or run are revoked.
  - Reconciliation requeues pending deliveries and queued runs.
  - Crash settlement: a run 2 minutes in is charged about 2 minutes instead of its 15-minute reservation. An hour-old run is capped at its 5-minute reservation, and settled usage is untouched. Deliveries are recorded for both.
  - Retention removes results after 30 days and screenshots after seven.
- `tests/egress.test.ts` (new):
  - DNS answers with a public address first and a private one afterwards. CONNECT tunnels and plain HTTP both go to the vetted address, with DNS resolved once.
  - Private, mixed and IPv4-mapped metadata answers, and non-443 tunnels, get 403 without connecting.
- `tests/api.integration.test.ts`: once the monthly quota is used up, a run is refused with 429 and nothing is reserved.

### Verified

- `pnpm typecheck` passed; `TEST_DATABASE_URL=… pnpm test` passed 81 of 81 across 11 files.
- The running dev worker reloaded with the startup recovery and kept serving.

### Still unverified

- Delivery to a real HTTPS receiver over the network; the tests replace the sender.
- The webhook and egress processes inside Docker Compose, and Chromium traffic actually routed through the proxy.
- BullMQ recovering a job whose worker process was killed.
- More than one worker process.

## 2026-09-14 (later) — Recorded steps, late content and the template lifecycle

### Causes found

- Fill, Click and Choose option steps were only written into the definition, so a login or search could not be recorded while using the site. Choose option had no button. New action steps were appended after the Collect items step, so they ran too late.
- Wait for used the normal 5-second element wait, so pages that render later failed; the sandbox's delayed page takes about 14 seconds.
- The Wait for notice showed the `{{…}}` "filled in only during runs" note because the Action value defaults to `{{searchTerm}}`.
- Check template updates offered the installed version as an update when no newer version was approved.
- The marketplace showed every approved version of a template as a separate card.
- Tall dialogs had no maximum height and the diff had no layout, so on a normal screen Apply update was below the window and could not be clicked or scrolled to.
- The in-app guide described an older workflow.

### Changed

- `packages/scraper-engine/src/index.ts`:
  - Wait for waits up to 30 seconds for the element or any fallback to be visible, and says so when it gives up.
  - Infinite scroll counts collection items and waits up to 5 seconds after each scroll for more to appear.
- `apps/worker/src/index.ts`: a `perform` message does Fill, Click and Choose option in the live browser and reports "The step was recorded, but it did not work in this browser: …" when it fails.
- `apps/web/components/builder.tsx`:
  - Choose option button.
  - Element checks: a select for Choose option, an input or textarea for Fill. An action value is required for both.
  - Action steps are inserted before the first collect, detail or pagination step.
  - Steps are done live while connected, except Wait for and values containing `{{…}}`.
  - The `{{…}}` note appears only for Fill and Choose option.
- `apps/web/app/api/v1/[...path]/route.ts`:
  - Template updates only offer approved versions newer than the installed one; otherwise the response is "You already have the latest approved version of this template."
  - The marketplace hides versions replaced by a newer approved version.
- `apps/web/app/globals.css`: dialogs scroll within the window; the update diff shows current and proposed side by side, each scrolling.
- `apps/web/app/docs/page.tsx`: guide rewritten. It covers collecting data, recording steps, logging in, more pages, results and repair, CSV downloads, webhook signature verification, templates and limits.
- Tests:
  - `tests/browser.test.ts`: a late-rendering element and items added after scrolling.
  - `tests/api.integration.test.ts`: an up-to-date install gets the 404 message.

### Verified

- Builder UI on quotes.toscrape.com in Chromium, one throwaway `@example.test` account deleted afterwards:
  - Flows 1–2, 14 of 14 checks:
    - A login recorded while doing it, with the password from a stored credential. The run returned 10 rows with the logged-in links.
    - A saved login session reused by a run without login steps; after Revoke the links were gone.
  - Flows 3–5, 12 of 12 checks:
    - A dropdown search replayed with two Choose option steps.
    - Infinite scroll returned 30 rows from 3 pages.
    - The delayed page returned 10 rows with Wait for.
- Template lifecycle through the UI on books.toscrape.com, two throwaway accounts deleted afterwards, 16 of 16 checks:
  - Version 1: submit from the editor, approve in the review queue, install on the second account; update check says it is up to date.
  - Version 2: submit and approve; the marketplace shows one card at v2. The diff is reviewed and applied, and a run returns 5 rows with the new field.
  - Repair: a broken selector fails with "step 2 (Collect items): No element matches …". Run history shows the failure, and Repair / edit opens that version with its error. The repaired run returns 5 rows.
  - The installed copy has versions 1–3, and there were no page errors.
  - The first attempt stopped at Apply update (dialog below the window); the CSS change fixed it.
- `pnpm typecheck` and `pnpm build` passed; `TEST_DATABASE_URL=… pnpm test` 65 of 65; `/docs` renders.

### Still unverified

- Safari and Firefox.
- Keyboard focus trapping in dialogs.
- Nested frames.
- Webhook delivery end to end.
- Docker Compose.
- Deployment.
- Login and sessions only against a public sandbox.
- The integration suites leave their `@example.test` users in the local test database.

## 2026-09-14 (later) — Dashboard completeness and reliability

### Causes found

- Several actions had no error handling and failed silently: revoking API keys and credentials; Cancel, Repair and Delete results in Run history; Approve and Reject in the review queue.
- The Webhooks and admin pages showed the heading "Review queue".
- Switching tabs rendered the previous tab's rows once with the new tab's components. This caused a React key warning going from Users to Domains, and a blank-page crash reading `listing.status` going from My scrapers to Review queue. A slow response for a tab already left could also overwrite the current tab.
- Scrapers could not be deleted, and every card said "Draft".
- Run history dumped results into a notice, had no scraper names or auto-refresh, and linked screenshots that did not exist.
- New API keys and webhook signing keys appeared in plain notices without a copy action, and API keys all got the same fixed name.
- The sidebar usage meter was static.
- Marketplace cards hid domains, inputs and sample output, and had no Report button although the API supported reports. The review queue mixed pending and decided templates and had no note field.
- Result rows are stored as `jsonb`, which reorders keys, so previews and exports did not follow the configured field order.
- Credentials accepted malformed domains and returned a 500 for duplicates.

### Changed

- `apps/web/components/dashboard.tsx` (new):
  - Scraper cards: last-run badge, delete with confirmation.
  - Run history: scraper name, status colors, auto-refresh while runs are active; a results dialog with Copy JSON, Download JSON and Download CSV; screenshot link only when one exists; delete results.
  - API keys: named keys with a one-time copy dialog. Credentials: inline validation and a `{{secret.name}}` reference.
  - Marketplace: details, Report dialog and Install. Review queue: Pending/Approved/Rejected filters and review notes.
- `apps/web/components/settings.tsx`:
  - Webhooks: a signing-key copy dialog and recent deliveries.
  - Users: usage this month and an admin badge.
  - Domain policies: validation. Abuse reports: template name and take-down confirmation.
- `apps/web/components/workspace.tsx`:
  - Every action goes through one helper that shows errors, and refreshes before showing a success message.
  - Every tab has the right heading.
  - One navigation function clears rows and reloads, including when the current tab is clicked again; slower responses for a tab already left are ignored.
  - A real usage meter.
- `apps/web/app/error.tsx` (new): a recovery screen with Try again and Reload instead of a blank page.
- `apps/web/app/api/v1/[...path]/route.ts`:
  - `GET /me` includes `usedMinutes`, and `GET /scrapers` includes `lastRun`.
  - `DELETE /scrapers/:id` is refused while a run is active or a public template exists. Otherwise it removes versions, runs, results, saved sessions, pending or rejected templates, and screenshots.
  - `GET /runs` includes `scraperName`, `storedRows` and `hasScreenshot`.
  - `GET /runs/:id/results?format=csv|json` downloads all rows; CSV text cells starting with `= + - @` are prefixed with `'`. Result rows follow the field order of the version that ran.
  - The webhook list includes recent deliveries.
  - Credential validation, with 409 for duplicates. Reports need at least 10 characters; rejecting needs a note.
  - Admin listings include creator and version; admin reports include template name and status; admin users include role and usage.
  - The update check for a deleted template returns 404 instead of crashing.
- `packages/scraper-engine/src/artifacts.ts`: `has()`.

### Verified locally

- `pnpm typecheck` and `pnpm build` passed. `TEST_DATABASE_URL=… pnpm test`: 63 tests passed in 9 files.
- New API integration tests cover:
  - usage, last runs and run names;
  - CSV export with formula-safe cells;
  - credential validation and duplicates;
  - report reasons and rejection notes;
  - deletion guards and cleanup, and a 404 for updates from a deleted template.
- Dashboard driven in Chromium with a creator/admin and a consumer (temporary `@example.test` accounts, deleted afterwards): 44 of 44 checks, with no browser console errors.
  - Scraper cards and deletion; run history, the results dialog, clipboard copy and CSV download; deleting results.
  - API key creation, copy, use and revocation; credential validation, duplicates and revocation; webhook validation, signing key and revocation.
  - Review notes and approval; the consumer's marketplace details, report and install; take-down; quotas; domain policies.
  - Tab switching in the orders that previously crashed, and re-clicking the current tab.
- `app/error.tsx` appeared for a temporary route that throws while rendering (route removed afterwards).

### Not verified / known issues

- Webhook deliveries were not exercised end to end: there was no public receiver, and the webhooks worker was not running locally.
- Deleting a scraper keeps its usage history. Private copies installed from a deleted template keep working but can no longer check for updates.
- Only Chromium was driven.

## 2026-09-14 (later) — Sign-in, sign-up and password reset forms

Reported: validation and behavior of sign-in and account creation were not up to standard.

### Causes found

- The dialog shared the page's error state, so it could open with "Please sign in" already in its error slot. Error text had no styles.
- There was no pending state: double clicks sent several sign-up requests (an earlier log shows three sign-ups and two 429 responses). Network failures were not caught.
- Validation came only from browser bubbles. Fields used placeholders instead of labels and had no autocomplete hints, no password confirmation and no show-password.
- Better Auth messages appeared raw, and there was no way to resend a verification email. After sign-up the form stayed in sign-up mode. Verification and reset links landed on pages without any message, and expired reset links were not handled.
- Names were only checked in the browser; the auth API accepted blank or very long names.

### Changed

- `apps/web/components/auth-dialog.tsx` (new): the sign-in/sign-up dialog.
  - Labeled fields with inline validation on blur and submit: name 1–80 characters, email format, password 12–128 characters, and password confirmation. Focus moves to the first invalid field.
  - Show/hide password and autocomplete hints. Only one request runs at a time, with a progress label.
  - Specific messages for Better Auth error codes, rate limits and network failures. Unverified accounts get **Send a new verification link**; existing accounts get **Sign in instead**. Escape closes the dialog.
  - Sign-up answers the same way for new and existing emails, then returns to sign-in with the email kept.
- `apps/web/components/workspace.tsx`: uses the dialog, and opens it with a message for `?verified=1`, failed verification links and `?signin=1`, then removes the query string.
- `apps/web/app/reset-password/page.tsx`: the same fields and messages, plus a confirmation field. `?error=INVALID_TOKEN` and rejected tokens return to the request form, and a success links to sign in.
- `apps/web/lib/auth.ts`: `databaseHooks.user.create.before` trims names and rejects blank names or names over 80 characters.
- `apps/web/app/globals.css`: field, error, message and link styles.
- Local `.claude/launch.json` (untracked): the preview attaches to `http://localhost:3000` with `autoPort: false`, because the preview launcher cannot read `~/Desktop` on this Mac. Start the web app with `.env` loaded first.

### Verified locally

- `pnpm typecheck` and `pnpm build` passed. `TEST_DATABASE_URL=… pnpm test`: 59 tests passed in 9 files. The new auth integration test rejects blank and 81-character names and stores trimmed names.
- Forms driven in Chromium against the running app: 27 of 27 checks.
  - Empty and invalid input is explained without a request, and focus moves to the first invalid field. Show password works.
  - Sign-in errors are explained: wrong password, unverified account (with resend), rate limit and network failure. Escape closes the dialog.
  - Sign-up: validation messages; a double submit sends one request and shows a progress label; the name is trimmed; the form returns to sign-in; an existing account gets its own message.
  - A real sign-in loads the workspace.
  - Email links: verification success and failure messages; reset request; expired and rejected reset tokens; signing in after a reset.
  - Endpoints that send email (sign-up, resend, reset request, reset) were mocked. Wrong-password, unverified and successful sign-ins used real temporary `@example.test` accounts, deleted afterwards.
- Post-reset layout: the Sign in button fills the width, with 16 px before the next link.

### Not verified / known issues

- Real email delivery for sign-up, resend and reset was not exercised in this pass.
- The dialog does not trap keyboard focus inside itself.
- Only Chromium was driven.

## 2026-09-14 — Pagination and detail pages in the editor, restart usage

### Changed

- **Worker restarts no longer charge the full browser reservation** (`apps/worker/src/index.ts`). Each browser session's cleanup (usage row, Redis leases, Chromium) now runs exactly once, whether the socket closes or the worker shuts down. Shutdown settles open sessions before closing Redis and PostgreSQL. Previously Redis quit before the WebSockets closed, so sessions stayed `browser-active` at the full 15-minute reservation. On startup, sessions a crash left `browser-active` are charged the time since they started, capped at the reservation.
- **Scrolling the remote browser also scrolled the editor** (`apps/web/components/builder.tsx`). The wheel listener on the browser view is now non-passive and prevents the page from scrolling.
- **Output field rows** (`apps/web/app/globals.css`): name, type and remove button now sit on one row.

### Verified locally

- `pnpm typecheck` and `pnpm build` passed. `TEST_DATABASE_URL=… pnpm test`: 58 tests passed in 9 files.
- Builder UI in Chromium on `books.toscrape.com`, with a temporary `@example.test` account deleted afterwards: 11 of 11 checks.
  - Selected the next-page link after scrolling the remote page, then **Use selection as Next**.
  - Set `maxPages` to 2 in the Definition dialog. The run followed the next link and returned 40 unique rows from 2 pages.
  - **Follow detail links**, then added a field from an opened product page. A run with `maxRows` 3 opened each detail page and returned availability for all 3 rows.
  - The wheel over the browser view did not scroll the editor. No page errors.
- Restart checks with a real browser session. A graceful `tsx watch` reload settled usage at 4.9 seconds with no leases left. After a SIGKILL and a new start, usage settled at 13.8 seconds with no leases left.
- Pagination and detail pages needed no engine changes; the existing behavior held up in these runs.

### Not verified / known issues

- Not exercised in the UI: infinite scroll, recording and replaying Fill/Click steps, template installation across two accounts, and version-2 repair.
- `tsx watch` does not restart a worker that was killed from outside; run `pnpm worker` again.
- Startup lease cleanup and crash usage settlement assume a single worker process.
- Still open: Safari and Firefox are untested; Preview reads only the page that is open.

## 2026-09-13 (later) — Visual editor bug sweep

Reported: runs still produced no output, many buttons appeared not to work, errors were silent and failures were hard to understand.

### Causes found

- The latest failed run used **Use as collection** on a product title, so each title became its own item, while the title field selector had been built for the product card. The run failed with a raw `locator.waitFor: Timeout 5000ms exceeded` call log.
- After reconnecting, the toolbar could show Select while the new worker session was in Interact, so clicks followed links.
- Adding a field with an existing name silently replaced it. Replace selector, Fill, Click and Wait for gave no feedback; Replace selector reported success with no step selected.
- Definition dialog errors were written behind the dialog, and schema errors (also from the API) were raw Zod JSON.
- Export navigated to a JSON error page; Check template updates returned 409 for scrapers not installed from a template; Submit template saved a version before asking for confirmation; Add input did not add a value to Run inputs, so runs failed with `Missing input`.
- Every missing optional field waited 5 seconds per item. Worker run failures said "Contact the administrator" and hid the cause. Session time limits and authentication failures closed the browser silently, and navigation to undeclared domains failed without a message.
- Selection: elements sharing classes inside an item (Amazon's image and text columns) resolved to the wrong element, and ratings such as `3.6` were suggested as prices.

### Changed

- **Builder** (`apps/web/components/builder.tsx`): errors show in red with actionable text. New **Preview** button extracts the first 5 items from the open page, reporting failing items and fields with no values, without saving or disconnecting. **Use as collection** prefers the repeating item around the clicked value and re-reads the last clicked element for the new collection. **Add output field** refuses selectors read for another collection or outside its items, and refuses duplicate names. The field form is pre-filled from the clicked element (title, price, number, url, image). Mode and collection are re-sent on connect. There is a **Disconnect** button, and disconnect reasons are shown. Steps show readable names and field counts. Failed runs highlight the step and show the error, page and a failure screenshot link. Every action button validates its input and confirms what it did. Export downloads through `fetch`; Check template updates appears only for installed templates; Submit template confirms first.
- **Contracts**: `explainDefinitionError` turns schema errors into `Step 2, field 1 (name): …`; used by the builder, worker and API.
- **Worker** (`apps/worker/src/index.ts`, `lease.ts`): `preview` and `inspect` messages. Navigation is checked against `allowedDomains` with a message naming the domain, and blocked link clicks are reported. A "Starting the browser…" notice covers the lease wait. Close reasons are sent for the time limit and authentication. Playwright call logs are trimmed to one line. The lease-contention message is clearer. Run failures log their cause, and lease contention is shown to the user.
- **Engine** (`packages/scraper-engine/src/index.ts`): no 5-second wait inside collection items; `No element matches "…"` errors; run errors name the item and field (`Item 4 of 16: Field "title": …`); `previewCollection` helper.
- **Selection** (`apps/worker/src/selection.ts`): positional fallback (`:scope > … :nth-of-type(n)`) when classes are shared inside an item; rating-like numbers are suggested as `number` rather than `price`.
- **API** (`route.ts`, `workspace.tsx`): readable validation errors, clearer 429 messages, and non-JSON error responses no longer surface as `Unexpected token`.

### Verified locally

- `pnpm typecheck` and `pnpm build` passed. `TEST_DATABASE_URL=… pnpm test`: 58 tests passed in 9 files. New tests cover definition error explanations, missing fields without waiting (with item and field in the error), preview with per-item errors, and shared-class disambiguation.
- The real builder UI was clicked through in Chromium (Playwright) against the running web app and worker, using a temporary `@example.test` account deleted afterwards:
  - `books.toscrape.com`: 18 of 18 checks. Run/Export/Definition errors explain themselves; Select mode survives connecting; the collection is created automatically (20 of 20 items); duplicate names and Fill on a link are refused; Preview shows 5 of 20 items with every field; Run succeeds with 20 JSON rows; reconnecting keeps Select; Disconnect works.
  - Live `www.amazon.in` search for `ps5` (the reported URL): 7 of 7 checks. Title found in 16 of 16 cards; price and image fields added; Preview returns rows with titles; Run succeeds with 16 rows. Price is present in 5 rows because the clicked price element only exists on cards with a standard offer.
- The UI scripts are kept outside the repository because they depend on third-party sites and create a temporary account.

### Not verified / known issues

- Only Chromium was driven; Safari and Firefox are untested.
- Preview reads the first 5 items of one collection on the current page; it does not replay fill/click steps, pagination or detail pages.
- Output field remove buttons render on their own lines (`.field-list` has no styles).
- Still open from the previous entry: usage for sessions killed by a worker restart, the single-worker lease assumption, and one interactive session per site.

## 2026-09-13 — Visual builder selection and runs

Reported: on `https://www.amazon.in/s?k=ps5…`, Select mode did not work and runs returned empty JSON.

### Fixed

- **Selection failed on every site** (`apps/worker/src/selection.ts`). The in-page picker was a TypeScript function passed to `frame.evaluate`. The worker runs under tsx, whose esbuild `keepNames` transform injects `__name(...)` calls that do not exist in the page (`ReferenceError: __name is not defined`). The picker is now source text evaluated in the page.
- **Selectors did not repeat across items.** Class-less elements produced `span` (1,121 matches on Amazon) and titles used per-product `aria-label` values. Selectors now prefer stable attributes (`data-testid`, `data-test`, `data-qa`, `data-cy`, `data-component-type`, `itemprop`, `name`) and classes, anchor bare tags to their parents, and use `aria-label` only as a short label on class-less elements.
- **Product cards were unreachable.** Only 5 parent levels were offered; Amazon cards sit 15 levels above the title. Up to 20 distinct ancestors are returned, each with `repeats` (matching siblings).
- **Field selectors were not relative to the collection item.** The worker now builds the shortest generic path inside the item and reports `rows: { matched, total }`, shown in the inspector as "found in X of Y items".
- **Runs returned `[]` because no collection step existed.** Without a chosen collection, the picker suggests the ancestor repeated most among its siblings (`collection`). **Add output field** in the builder creates or reuses that collection step. Collection fields use item-relative selectors; `followEach` fields keep page-wide selectors.
- **Running with nothing to extract** now shows guidance instead of saving a version that returns 0 rows. Run status messages include the row count.
- **Hover floods** could hit the worker's 100-pending-message limit and silently disconnect. The builder sends at most ~10 hovers per second, hovers only draw the highlight, and the worker skips hovers superseded by queued input. The builder shows the disconnect reason.
- **Worker restarts locked users out for up to 16 minutes** (`apps/worker/src/index.ts`). `browser-capacity`, `browser-domain:*` and `browser-owner:*` leases outlived the process (including every `tsx watch` reload). The worker clears them at startup; this assumes a single worker process (see the `ponytail:` comment). Close-handler Redis calls no longer crash the worker with unhandled rejections during shutdown.

### Environment

- `.env.example`: `EMAIL_FROM` is quoted (the unquoted `<` broke `set -a; . ./.env`), with notes for local versus Docker values of `REDIS_PORT`, `ARTIFACT_DIR` and `BROWSER_PROXY`, and URL-safe password generation.
- Local `.env` (untracked): new `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` (the previous values were the public test values), an absolute `ARTIFACT_DIR` (web and worker run from different working directories), and a Resend sender.

### Verified locally

- `pnpm typecheck` and `pnpm build` passed.
- `TEST_DATABASE_URL=… pnpm test`: 54 tests passed in 9 files (PostgreSQL 18.6, Redis 8.10.1, Chromium), with the dev worker running. New `tests/selection.test.ts` runs the picker under tsx like the worker; before the fix it failed with `__name is not defined`, and with the tsx issue bypassed it failed on wrong selectors.
- End to end against live `www.amazon.in` (search `ps5`) through the real web API, worker WebSocket and BullMQ queue, using a temporary `@example.test` user and API key deleted afterwards. A title click suggested the collection `div[data-component-type="s-search-result"]` (16 of 16 items); title, link and image fields matched 16 of 16; version 1 was saved; the run `succeeded` with 10 rows of title, url, image and price. That script was a scratch harness, not committed, because it depends on a third-party site.

### Not verified / known issues

- The agent did not click through the builder UI; a script sent the same WebSocket messages. Confirm the UI flow by hand.
- A worker restart during an interactive session leaves its `usage_events` row as `browser-active` with the full reservation (up to 15 minutes charged). The shutdown handler quits Redis before closing WebSockets, so close handlers cannot settle usage.
- One interactive session per target domain across all users (`browser-domain:<domain>` lease): two people cannot build scrapers for the same site at the same time.
- Which element is clicked matters: on Amazon a secondary price element matched only 5 of 16 cards, while the main price digits match most. Amazon may block automation or change markup at any time and is not a guaranteed target.
