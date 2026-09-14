# Changelog

Newest first. Add an entry for every change: what changed and why, how it was verified, and what is still unverified. Read it with `IMPLEMENTATION_STATUS.md` before continuing work.

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
