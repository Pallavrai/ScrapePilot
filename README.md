# ScrapePilot

Visual scraper authoring, asynchronous execution, and reviewed community templates in a Next.js / Playwright monorepo.

## Start locally

Requires Node 24 LTS, pnpm 12.4.1, PostgreSQL, Redis, and a configured transactional-email sender. Copy `.env.example` to `.env`, fill the database, Redis, email, and encryption settings, and keep that file private. Generate independent `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` values with `openssl rand -base64 32`.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm --filter @scrapepilot/scraper-engine exec playwright install chromium
pnpm dev
```

In a separate terminal, run `pnpm worker`. Export environment variables into both processes (or use `node --env-file=.env` with the corresponding entrypoint). Next.js also accepts `apps/web/.env.local`; do not commit it. Local development without `BROWSER_PROXY` has DNS checks but is not the production network boundary. Webhooks are sent by a third process, `pnpm exec tsx apps/worker/src/webhooks.ts` (the `webhooks` service in Compose); without it deliveries stay pending. Webhook receivers must be public HTTPS URLs.

## Docker deployment

Set `APP_DOMAIN`, `BETTER_AUTH_URL=https://your-domain`, `WORKER_PUBLIC_URL=wss://your-domain/browser`, and the secret settings in `.env`. Use URL-safe database credentials. Follow the staged startup and migration sequence in `DEPLOYMENT.md` before accepting traffic. Public ports are only 80/443. PostgreSQL, Redis, workers, and the egress proxy are not exposed to the host.

The browser worker has only an internal Docker network. The egress proxy connects to a validated numeric public IP after checking every DNS answer, including HTTPS CONNECT destinations. Browser request routing separately enforces declared navigation domains. Chromium browser contexts isolate sessions, but do not constitute hostile-code sandboxing: production hardening and Docker integration tests remain launch gates. Do not expose an unrestricted Chrome debugging port.

## Accounts

Sign up and verify the email sent through Resend. There is no bypass account or default password. Bootstrap the administrator by changing the intended verified user's `role` to `admin` in PostgreSQL through an operator-controlled session. Admins review marketplace versions at the Review queue. Regular users cannot assign their own roles.

## Workflow

Create a scraper using a public URL. Connect the browser worker, switch between Interact and Select, and add fill/click/wait steps. In Select, click a value inside a repeating item (for example a product title), name it, and choose Add output field: the builder creates the collection from the repeating item and the inspector shows how many items the field is found in. To use a different container, pick a parent in the inspector and choose Use as collection. Use Preview to check the first items on the open page before running; Run disconnects the builder browser because one browser at a time may use a site. Collection steps with no fields intentionally fail validation until configured. Drag to reorder. The Definition editor exposes typed inputs, detail fields, pagination, required flags, and fallback locators. Save a version and run with JSON inputs. Runs are asynchronous; inspect Run history for results.

Use `{{searchTerm}}` for ordinary inputs and `{{secret.password}}` for stored secrets. Credentials are domain-bound and tenant-bound. Export bundles the engine into a portable TypeScript/ESM entrypoint; install the exact Playwright release indicated in its header and provide inputs through environment variables.

## Chrome extension

`apps/extension` runs saved scrapers in a person's own Chrome, with the logins they already have. Scrapers are still built in the editor; definitions, limits, duplicate handling and results stay on the server, so browser runs appear in Run history, the API and webhooks. Build it for your server with `SCRAPEPILOT_URL=https://your-domain pnpm --filter @scrapepilot/extension build` and load `apps/extension/dist` with Load unpacked in `chrome://extensions`. People connect it at `/extension/connect`. `EXTENSION_PLAN.md` describes how runs work and what is left.

## API

Generate a key in API keys and store the displayed value immediately. Send `Authorization: Bearer sp_...` to `/api/v1` routes. Use `Idempotency-Key` when creating runs. The run endpoints are documented in `IMPLEMENTATION_PLAN.md`. Session-authenticated browser writes additionally require a matching Origin header.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

See `IMPLEMENTATION_STATUS.md` for verified checks, incomplete requirements, and the next launch gates. This is the source of truth for continuation by another coding agent. Do not infer production readiness from the presence of a UI or passing unit tests.
