# Changelog

Newest first. Add an entry for every change: what changed and why, how it was verified, and what is still unverified. Read it with `IMPLEMENTATION_STATUS.md` before continuing work.

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
