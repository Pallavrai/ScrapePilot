# ScrapePilot continuation

Read `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`, and `README.md` before changing the implementation. `DEPLOYMENT.md` documents operator setup and recovery. See `apps/web/AGENTS.md` for the installed Next.js documentation requirement.

Use pnpm 12.4.1 and exact dependency versions. Generate database changes through Drizzle Kit and retain its migration ledger. Do not introduce production authentication bypasses or embed target credentials in definitions, exports, fixtures, or logs. Run the PostgreSQL/Redis integration suite as well as the browser tests; a web build alone does not validate the worker.

Keep status evidence and remaining acceptance gates up to date. Never treat the existence of an implementation as evidence that its production behavior has been verified.
