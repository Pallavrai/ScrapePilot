# ScrapePilot continuation

Read `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, and `README.md` before changing the implementation. `DEPLOYMENT.md` documents operator setup and recovery. `EXTENSION_PLAN.md` describes the Chrome extension in `apps/extension`, how its runs use the server and what is left; read it before working on the extension or the browser-run API. See `apps/web/AGENTS.md` for the installed Next.js documentation requirement.

Use pnpm 12.4.1 and exact dependency versions. Generate database changes through Drizzle Kit and retain its migration ledger. Do not introduce production authentication bypasses or embed target credentials in definitions, exports, fixtures, or logs. Run the PostgreSQL/Redis integration suite as well as the browser tests; a web build alone does not validate the worker.

Keep status evidence and remaining acceptance gates up to date. Add a dated `CHANGELOG.md` entry for every change: what changed and why, how it was verified, and what remains unverified.

The worker runs under tsx, whose esbuild `keepNames` transform breaks TypeScript functions with named inner functions passed to Playwright `evaluate`; pass page scripts as source text (see `apps/worker/src/selection.ts`). Never treat the existence of an implementation as evidence that its production behavior has been verified.
