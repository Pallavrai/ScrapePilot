# Browser extension: ScrapePilot for Chrome

Scoped on 2026-09-14 against commit `5b92819`, then changed the same day by the owner's direction below. Firefox and Safari are out of scope.

## Direction (owner, 2026-09-14)

- Scrapers are built in the ScrapePilot editor, as today. The extension runs a saved scraper in the person's own browser with one click.
- Rules and storage stay on the server:
  - the definition, allowed and blocked domains
  - row and size limits, and duplicate handling
  - results, Run history, API access and webhooks
- The extension saves nothing to the person's computer. Results go to their account, where they can use them through the API.

This replaces the earlier plan of a side-panel editor with JSON and CSV downloads.

## Status

The first slice is built and tested in Playwright's Chromium (see `CHANGELOG.md`, 2026-09-14 night):

- account connection
- one-click runs from the popup, with run inputs
- next pages and infinite scroll
- row upload under server rules
- Stop, and Cancel from Run history
- runs that stop checking in are given up after 20 minutes

It has not been tried in a real Chrome install, against a deployed server or on a live site. It is not in the Chrome Web Store.

## How it works

| Part | File in `apps/extension/src` | Job |
|---|---|---|
| Popup | `popup.html`, `popup.ts` | Connect, list saved scrapers, ask for run inputs, Run, show progress, Stop, Disconnect. |
| Service worker | `background.ts` | Starts the run on ScrapePilot, drives the tab one step at a time, uploads rows, reports the outcome. |
| Page runner | `page.ts` | Injected into the run's tab on the scraper's sites. Does one step, or reads rows with the cloud engine's `convert()`. |
| Connect script | `connect.ts` | Runs only on ScrapePilot's `/extension/connect` page and receives this browser's key. |
| ScrapePilot | `/api/v1` | Definitions, rules, results, Run history, API and webhooks. |

```text
Popup --runtime message--> Service worker --executeScript--> page.ts in the run's tab
                                 |
                       HTTPS, Bearer key for this browser
                                 |
                          ScrapePilot /api/v1
```

### A run, step by step

1. **Run** in the popup asks Chrome for the scraper's allowed domains, over http and https. Chrome only shows that prompt right after a click.
2. The service worker calls `POST /api/v1/scrapers/:id/browser-runs`. The server:
   - takes the latest saved version and checks the inputs
   - refuses blocked domains, stored credentials and detail pages
   - creates a run with `source = browser` and status `running`
   - returns the definition and the checked inputs
3. The worker opens a visible tab and does the steps.
   - Page loads are at most one per second.
   - A run stops as blocked at HTTP 401, 403 and 429 and at CAPTCHA pages.
   - It fails if the page leaves the allowed domains.
   - Every 5 seconds it checks that the run is still `running` on the server.
4. After each collection step, rows go to `POST /api/v1/runs/:id/rows` in batches under 800 KB. The server:
   - keeps only the scraper's fields
   - skips duplicates, by `deduplicationKey` or by the whole row
   - stops at `maxRows` rows or 10 MB
5. `POST /api/v1/runs/:id/finish` records the outcome.
   - A failure after some rows is stored as partial.
   - It sets the duration and adds webhook deliveries, which the worker's reconciler sends within 30 seconds.
6. If the browser, the tab or the service worker goes away, the run cannot report.
   - When the service worker starts again, it ends the run as failed.
   - Otherwise the worker's reconciler ends it after 20 minutes as failed or partial, keeping uploaded rows.

A new document is detected by a marker set in the extension's isolated world on the previous document. Clicks wait for a page load only when Chrome reports the tab loading.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/scrapers` | Now includes `latestVersion` (number, allowed domains, inputs) so the popup can start a run in one request. |
| `POST /api/v1/scrapers/:id/browser-runs` | Starts a browser run. 400 for stored credentials, detail pages or missing inputs; 403 for a blocked domain; 409 without a saved version. |
| `POST /api/v1/runs/:id/rows` | `{ rows }`, up to 1,000 per request and 1 MB. Answers `{ added, rowCount, limit }`, where `limit` is `rows`, `size` or null. 409 once the run is canceled, finished or past its time limit. |
| `POST /api/v1/runs/:id/finish` | `{ status: succeeded, failed, blocked or canceled, error? }`. 409 if the run already ended. |
| `POST /api/v1/runs/:id/cancel` | Now also cancels running browser runs. |

- Browser runs use no browser minutes.
- They do not count as the account's active cloud run.
- They are marked "In your browser" in Run history.
- Migration `0004` adds `runs.source`: `cloud`, the default, or `browser`.

## Supported steps

| Step | In the extension | Notes |
|---|---|---|
| Open page | Built | Allowed domains only, paced. |
| Fill | Built | Sets `value` from the isolated world and fires input and change, so React forms notice. Content-editable elements too. |
| Click | Built | `click()`; waits for a page load if one starts. |
| Choose option | Built | By value, then by label, like Playwright's `selectOption`. |
| Wait for | Built | Up to 30 seconds for a visible match. |
| Collect items | Built | Same conversion, required fields and item error messages as cloud runs. |
| Next pages | Built | Waits for a page load or up to 10 seconds for the listed items to change. |
| Infinite scroll | Built | Waits up to 5 seconds for more items. |
| Run inputs (`{{searchTerm}}`) | Built | Asked for in the popup. |
| Frames | Same-site only | Through `contentDocument`; cross-origin frames fail with a clear message. |
| Detail pages | Not yet | Refused at start. |
| Stored credentials (`{{secret.name}}`) | Cloud only | Refused at start. People are already signed in in their own browser. |
| Selectors | CSS only | Playwright-only syntax such as `text=` fails with a clear message. |

## Permissions

| Manifest entry | Justification for the store listing |
|---|---|
| `scripting` | Runs a scraper's steps in the tab it opens, on sites the user allowed. |
| `storage` | Keeps this browser's connection and the status of the latest run. |
| `host_permissions` | Only the ScrapePilot site, to start runs and save results. |
| `optional_host_permissions` | Requested per scraper, for its allowed domains, when the user first runs it. |
| `content_scripts` | Only on ScrapePilot's `/extension/connect` page, to receive this browser's key. |

Not requested: `sidePanel`, `activeTab`, `tabs`, `cookies`, `webRequest`, `debugger`, `history`, `externally_connectable`, or access to all sites at install.

## Build and load

```sh
SCRAPEPILOT_URL=https://your-domain pnpm --filter @scrapepilot/extension build
```

Load `apps/extension/dist` with Load unpacked in `chrome://extensions`. Without `SCRAPEPILOT_URL` it builds for `http://localhost:3000`. The build writes the manifest, so the ScrapePilot address is fixed per build.

## Guardrails

- Runs start only when the user presses Run, on sites they allowed. No schedules.
- The tab is visible and loads at most one page per second.
- Runs stop at CAPTCHA pages and at HTTP 401, 403 and 429, with no solving and no retries.
- No proxies, fingerprint changes or hidden windows; it is the user's normal browser.
- Blocked domains and the Acceptable Use Policy apply; the popup links to the policy.

## Remaining work, in order

1. **Real-browser check.** Load the extension in installed Chrome against a running ScrapePilot, connect through the real connect page, and run a scraper on a site the owner is allowed to automate while signed in.
2. **Store listing.**
   - icons and screenshots
   - the permission justifications above
   - privacy disclosures matching the Privacy Policy's extension section
   - a published privacy policy address
   - a production build for the real domain
3. **Service worker restarts.** A run currently ends as failed when Chrome restarts the service worker; resume it from saved state instead.
4. **Detail pages** in background tabs, one at a time and paced.
5. **Cross-origin frames** through per-frame injection, and a clear path for Playwright-only selectors.
6. **Start from the dashboard:** a Run in my browser button that hands the run to the extension.
7. **Later:** building scrapers from the extension, schedules while Chrome is open, Edge Add-ons.

## Risks

| Risk | Mitigation |
|---|---|
| **Store review.** Extensions that read many sites get extra scrutiny. | Per-site permissions, one stated purpose, published disclosures. |
| **Service worker lifecycle.** Chrome stops idle workers. | An extension API call every 20 seconds during a run; a restarted worker ends the run clearly; the server gives up after 20 minutes. |
| **Account restrictions.** Sites can limit accounts that automate, even from the owner's browser. | Pacing, hard stops, and the Acceptable Use Policy placing account risk with the user. |
| **Two runners drifting apart.** | One definition format, shared `convert()`, and `tests/extension.test.ts` comparing rows with cloud runs on the same fixture pages. |
| **Synthetic events.** Some sites ignore `click()` or value changes that are not user input. | Cloud runs remain available; trusted input would need the `debugger` permission, which is not planned. |
| **The key reaches the page.** The connect page passes the key to the extension with `postMessage`, which other extensions on that page could read. | Key per browser, revocable under API keys; consider `externally_connectable` once the store assigns a fixed extension ID. |

## Decisions

Decided by the owner:
- Results are stored on the server, not downloaded.
- Rules live on the server.

Applied as defaults the owner can change:
- Browser runs use no browser minutes.
- They don't block cloud runs.
- Blocked domains apply.
- Each browser runs one scraper at a time.
- Each connection creates a key named "Chrome extension, <date>".

Still open:
- Edge Add-ons at launch or later.
- Sites excluded by default.
- A fair-use limit on browser-run rows.
- Schedules.

## Codebase facts

Checked on 2026-09-14.

- `apps/web/lib/server.ts`: `identity()` lets Bearer keys skip the Origin check. The API allows 120 requests a minute per user; a run uses about one status check every 5 seconds plus one upload per collected page. `readBody` takes a size limit (1 MB for row uploads).
- `packages/scraper-engine/src/convert.ts` has no Playwright import and is shared by the engine and the extension.
- `packages/contracts` imports zod, so `background.js` bundles it (about 800 KB).
- `apps/worker/src/maintenance.ts`: `failInterruptedRuns` gives browser runs at least 20 minutes, so a worker restart does not end them.
- The extension tests need the full Chromium build (`channel: "chromium"`), which `playwright install chromium` installs next to the headless shell.
