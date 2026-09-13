# ScrapePilot implementation plan

Accepted product decisions: multi-tenant Next.js SaaS on one Docker VPS; verified email/password signup; private scrapers; guided multi-page visual authoring; UI/API execution and Playwright TypeScript export; encrypted stored target credentials and reusable sessions; free installable public marketplace templates; administrator approval for every published version; metered beta; structured results retained 30 days and diagnostics 7 days. No team workspaces, payments, schedules, arbitrary uploaded code, or stealth guarantees in v1.

## Architecture

pnpm workspace: `apps/web`, `apps/worker`, `packages/contracts`, `packages/db`, `packages/scraper-engine`, `packages/ui`. Next.js handles accounts, authoring, API, and results. Redis/BullMQ dispatches bounded jobs to Chromium. PostgreSQL/Drizzle stores owner-scoped records and immutable definitions. Caddy terminates HTTPS and proxies the browser WebSocket. A DNS-pinned egress proxy is the only external network path for the Docker worker. BrowserContext isolation is session isolation, not an OS security boundary.

## User acceptance journey

Enter a site, declare a search input, select and fill its search box, record submission, identify repeated product cards, map typed fields, follow detail links, paginate, preview JSON, publish a version, execute by API, submit a marketplace template, install under a second account, and repair a changed selector by publishing a new version. Test on a controlled store with the query `nerf gun`; Amazon is only an illustrative target and has no guaranteed access.

## Contracts

`ScraperDefinitionV1`: schemaVersion, name, allowedDomains, typed inputs, steps, deduplicationKey, limits. Input kinds: text, number, boolean, url, secretRef. Step kinds: navigate, fill, click, select, waitFor, extractCollection, followEach, paginate. Fields support text/attribute/innerHTML, typed conversion, required/null handling, trimming, numeric normalization, and planned bounded regular-expression transforms. Locators have primary/fallbacks, optional frame and fingerprint. Published definitions are immutable; edits remain drafts until explicitly versioned.

Run states: queued, running, succeeded, partial, blocked, failed, canceled. Default limits: 1 interactive browser and 1 active run per user; 100 browser-minutes/month; 15 minutes/run; 25 pages/run; 1,000 rows/run; 10 MB JSON/run. Global worker concurrency 2. Domain throttling approximately 1 navigation/second and at most 2 pages. Retry only transient failures, at most twice. Fail access blocks explicitly.

API:

- POST `/api/v1/scrapers/{id}/runs` with `{version?,input}` and optional Idempotency-Key; 202 `{runId,status}`.
- GET `/api/v1/runs/{runId}` and `/results?cursor=&limit=`.
- POST `/api/v1/runs/{runId}/cancel`.
- GET `/api/v1/scrapers/{id}/input-schema` and `/export?version=`.
- Signed, bounded-retry webhooks for run.completed, run.partial, run.failed, run.blocked.

## Security and marketplace

Verified accounts only; server-side tenant ownership on every private resource; API keys displayed once and stored hashed. Target credentials and sessions encrypted with authenticated tenant/domain binding, master keys outside DB, revocable references, redacted diagnostics. Saved cookies expire within 7 days and MFA is manual. No CAPTCHA solving or anti-bot evasion claims. Reject private/reserved IPs, credentials in URLs, unsafe ports, redirects to internal networks, and undeclared navigation domains. Enforce the network boundary for subresources, WebSockets, service workers, and webhooks.

Publishing copies only reviewed definitions and explicit public metadata. No cookies, target credentials, private results, or keys. Consumers supply their own inputs/secrets. Install pins a version; upgrading requires an explicit diff. Every public version needs automated validation and administrator review. Support domain blocks, abuse reports, suspension, quotas, retention, and operator audit records.

## Delivery sequence

1. Workspace, deployment, schema/migrations, auth, UI shell, CI.
2. Remote browser protocol, selection, expiry, network controls.
3. Steps, collections/detail fields, pagination, inputs, JSON preview, repair/version flow.
4. Queue, quotas, cancellation, API, usage, diagnostics, webhooks, portable export.
5. Marketplace, review, installation, version upgrade, reports.
6. Metrics, retention, encrypted off-host backups, recovery rehearsal, live authorized smoke test.

## Validation and handoff

Unit-test contracts, conversion, interpolation, missing fields, deduplication, limits, secret binding, URL/IPv4/IPv6/DNS controls. Integration-test ownership, signup/reset, immutable versions, idempotency, cancellation, queue failure, webhooks, secret leaks, marketplace review/updates and retention. Controlled fixture store covers dynamic pages, frames, delayed content, pagination, scroll, login, missing fields, duplicates, blocks and redesign. Run end-to-end with two accounts. Test two browser jobs on actual VPS and retain memory reserve. Exercise backup restoration. Verify deployed HTTPS, email and WSS against an owned target before beta.

Use latest mutually compatible stable releases, exact dependency pins and committed lockfile. Node 24 LTS in Docker. Match installed Chromium to Playwright. Registry baseline checked during this session: Next 16.3.5, React 19.3.0, TS 7.0.2, Better Auth 1.7.4, Drizzle 0.45.2 / Kit 0.31.10, Playwright 1.63.0, BullMQ 6.3.4, Redis client 6.0.0. Compatibility and actual test results take precedence over this snapshot.

The separate IMPLEMENTATION_STATUS.md tracks implementation evidence and unfinished work; update it when continuing.
