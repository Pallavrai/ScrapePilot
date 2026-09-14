import Fastify from "fastify";
import { leaseBrowser } from "./lease";
import { LocalArtifactStore } from "@scrapepilot/scraper-engine/artifacts";
import { inspect } from "./selection";
import {
  applyRetention,
  deliveryJob,
  failInterruptedRuns,
  reconcile,
} from "./maintenance";
import websocket from "@fastify/websocket";
import { Worker, Queue } from "bullmq";
import Redis from "ioredis";
import { collectDefaultMetrics, register, Counter } from "prom-client";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  client,
  runs,
  versions,
  secrets,
  resultRows,
  policies,
  browserSessions,
  usageEvents,
  user,
  webhooks,
  webhookDeliveries,
  eq,
  and,
  sql,
} from "@scrapepilot/db";
import { definitionSchema, explainDefinitionError } from "@scrapepilot/contracts";
import {
  execute,
  chromium,
  locate,
  protectContext,
  previewCollection,
} from "@scrapepilot/scraper-engine";
import {
  assertPublicUrl,
  decrypt,
  encrypt,
  hash,
} from "@scrapepilot/scraper-engine/security";
const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};
const redis = new Redis({ ...connection, maxRetriesPerRequest: null });
// In Compose the worker has no route or DNS to the internet; the egress proxy resolves and
// checks every destination, so URL checks here skip the DNS lookup when a proxy is set.
const viaProxy = process.env.BROWSER_PROXY ? null : undefined;
const app = Fastify({
  logger: {
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "token",
      "password",
      "secret",
    ],
  },
  bodyLimit: 65536,
});
collectDefaultMetrics();
const completed = new Counter({
  name: "scrapepilot_runs_total",
  help: "Completed scraping runs",
  labelNames: ["status"],
});
const blocked = async (domain: string) => {
  const [p] = await db
    .select()
    .from(policies)
    .where(eq(policies.domain, domain));
  return p?.blocked ?? false;
};
async function throttle(url: string) {
  const host = new URL(url).hostname;
  for (;;) {
    const acquired = await redis.set(
      `navigation:${host}`,
      "1",
      "PX",
      1000,
      "NX",
    );
    if (acquired) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}
const root = resolve(process.env.ARTIFACT_DIR ?? "artifacts");
const artifactStore = new LocalArtifactStore(root);
const deliveryQueue = new Queue("webhooks", { connection });
const worker = new Worker(
  "runs",
  async (job) => {
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, job.data.runId));
    if (!run || run.status !== "queued") return;
    const [claimed] = await db
      .update(runs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(runs.id, run.id), eq(runs.status, "queued")))
      .returning();
    if (!claimed) return;
    const [actor] = await db
      .select()
      .from(user)
      .where(eq(user.id, run.ownerId));
    if (!actor || actor.suspended) throw new Error("Account suspended");
    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, run.versionId));
    const definition = definitionSchema.parse(version.definition);
    const [reservation] = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.id, run.id));
    if (reservation)
      definition.limits.timeoutMs = Math.max(
        1000,
        Math.min(definition.limits.timeoutMs, reservation.durationMs),
      );
    const stored = await db
      .select()
      .from(secrets)
      .where(eq(secrets.ownerId, run.ownerId));
    const values: Record<string, string> = {},
      secretDomains: Record<string, string> = {};
    for (const s of stored)
      if (definition.allowedDomains.includes(s.domain)) {
        values[s.name] = decrypt(
          s.encrypted,
          `${s.ownerId}:${s.domain}:${s.name}`,
        );
        secretDomains[s.name] = s.domain;
      }
    const [saved] = await db
      .select()
      .from(browserSessions)
      .where(
        and(
          eq(browserSessions.ownerId, run.ownerId),
          eq(browserSessions.scraperId, run.scraperId),
          sql`${browserSessions.expiresAt}>now()`,
        ),
      );
    const storageState = saved
      ? JSON.parse(
          decrypt(saved.encrypted, `${run.ownerId}:session:${run.scraperId}`),
        )
      : undefined;
    const controller = new AbortController();
    let releaseLease = async () => {};
    const timer = setInterval(() => {
      void redis.get(`cancel:${run.id}`).then((v) => {
        if (v) controller.abort();
      });
    }, 500);
    try {
      releaseLease = await leaseBrowser(
        redis,
        run.id,
        definition.allowedDomains,
      );
      const result = await execute(
        definition,
        run.input as Record<string, unknown>,
        {
          secrets: values,
          secretDomains,
          storageState,
          onSession: async (state) => {
            if (saved)
              await db
                .update(browserSessions)
                .set({
                  encrypted: encrypt(
                    JSON.stringify(state),
                    `${run.ownerId}:session:${run.scraperId}`,
                  ),
                })
                .where(eq(browserSessions.id, saved.id));
          },
          signal: controller.signal,
          proxy: process.env.BROWSER_PROXY,
          beforeNavigation: throttle,
          blocked,
          onFailure: async (page) => {
            await mkdir(root, { recursive: true });
            /* Screenshots can contain sensitive account data: only capture public workflows. */ if (
              !stored.length &&
              !saved
            ) {
              await artifactStore.put(run.id, "png", await page.screenshot());
              await artifactStore.put(run.id, "html", await page.content());
            }
          },
        },
      );
      await db.transaction(async (tx) => {
        if (result.rows.length)
          await tx.insert(resultRows).values(
            result.rows.map((data, position) => ({
              runId: run.id,
              position,
              data,
            })),
          );
        await tx
          .update(runs)
          .set({
            status: result.status,
            error: result.error ?? null,
            rowCount: result.rows.length,
            durationMs: result.durationMs,
            finishedAt: new Date(),
          })
          .where(eq(runs.id, run.id));
        const hooks = await tx
          .select()
          .from(webhooks)
          .where(eq(webhooks.ownerId, run.ownerId));
        if (hooks.length)
          await tx.insert(webhookDeliveries).values(
            hooks.map((hook) => ({
              id: `${run.id}-${hook.id}`,
              webhookId: hook.id,
              runId: run.id,
            })),
          );
      });
      await db
        .insert(usageEvents)
        .values({
          id: run.id,
          ownerId: run.ownerId,
          kind: "run",
          durationMs: result.durationMs,
        })
        .onConflictDoUpdate({
          target: usageEvents.id,
          set: { kind: "run", durationMs: result.durationMs },
        });
      const hooks = await db
        .select()
        .from(webhooks)
        .where(eq(webhooks.ownerId, run.ownerId));
      for (const hook of hooks)
        await deliveryQueue.add(
          "deliver",
          { webhookId: hook.id, runId: run.id },
          { jobId: `${run.id}-${hook.id}`, ...deliveryJob },
        );
      completed.inc({ status: result.status });
    } catch (e) {
      app.log.error(
        {
          runId: run.id,
          error: e instanceof Error ? e.message.split("\n")[0] : "Unknown",
        },
        "Run failed",
      );
      throw e;
    } finally {
      await releaseLease();
      clearInterval(timer);
    }
  },
  { connection, concurrency: 2 },
);
worker.on("error", (err) =>
  app.log.error({ name: err.name }, "Queue worker error"),
);
worker.on("failed", (job, err) => {
  if (!job) return;
  void db
    .transaction(async (tx) => {
      const [failed] = await tx
        .update(runs)
        .set({
          status: "failed",
          error: {
            // Lease contention is actionable; other infrastructure errors stay in the worker log.
            message: err?.message.startsWith("Another browser session or run")
              ? err.message
              : "The worker hit an internal error while running this scraper. Details are in the worker log.",
          },
          finishedAt: new Date(),
        })
        .where(and(eq(runs.id, job.data.runId), eq(runs.status, "running")))
        .returning();
      if (failed)
        await tx
          .update(usageEvents)
          .set({
            kind: "run",
            durationMs: Math.min(
              900000,
              Math.max(
                0,
                Date.now() - (failed.startedAt?.getTime() ?? Date.now()),
              ),
            ),
          })
          .where(eq(usageEvents.id, failed.id));
      if (failed) {
        const hooks = await tx
          .select()
          .from(webhooks)
          .where(eq(webhooks.ownerId, failed.ownerId));
        if (hooks.length)
          await tx
            .insert(webhookDeliveries)
            .values(
              hooks.map((hook) => ({
                id: `${failed.id}-${hook.id}`,
                webhookId: hook.id,
                runId: failed.id,
              })),
            )
            .onConflictDoNothing();
      }
    })
    .catch(() => app.log.error("Could not persist failed run"));
});
// Browsers never survive a worker restart (crash, deploy, tsx watch reload), but their
// Redis leases would lock users out for up to 16 minutes; release them before serving.
// ponytail: assumes this process holds every lease (Compose runs one worker); key leases by worker id before scaling out.
await redis.del("browser-capacity");
for (const pattern of ["browser-domain:*", "browser-owner:*"]) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}
// Runs still marked running died with it too: fail them now rather than after 20 minutes,
// charging only the time they ran.
await failInterruptedRuns(0);
// Sessions still marked active died with the previous process (a crash skips shutdown);
// charge at most the time since each started instead of the whole reservation.
await db.execute(
  sql`update usage_events set kind='browser', duration_ms=least(duration_ms, (extract(epoch from now()-created_at)*1000)::int) where kind='browser-active'`,
);
// Cleanups of open browser sessions, so shutdown can settle them while Redis and PostgreSQL are connected.
const sessionCleanups = new Set<() => Promise<unknown>>();
await app.register(websocket, { options: { maxPayload: 65536 } });
app.get("/health", async () => {
  await redis.ping();
  await db.execute(sql`select 1`);
  return { status: "ok" };
});
app.get("/metrics", async (_, reply) =>
  reply.type(register.contentType).send(await register.metrics()),
);
app.get("/browser", { websocket: true }, (socket, req) => {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
    page: any,
    ownerId = "",
    scraperId = "",
    token = "",
    mode = "interact",
    container = "",
    allowedDomains: string[] = [],
    authenticated = false;
  let messages = Promise.resolve();
  let pendingMessages = 0;
  const sessionStarted = Date.now();
  let releaseLease = async () => {};
  let expiry = setTimeout(
    () => socket.close(1000, "Browser session time limit reached"),
    900000,
  );
  const authExpiry = setTimeout(() => {
    if (!authenticated) socket.close(1008, "Browser authentication timed out");
  }, 10000);
  const send = (data: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(data));
  };
  // Record usage and release leases exactly once: when the socket closes or the worker shuts down.
  let settled: Promise<unknown> | undefined;
  const settle = (): Promise<unknown> =>
    (settled ??= Promise.allSettled([
      browser?.close(),
      releaseLease(),
      ownerId &&
        db
          .insert(usageEvents)
          .values({
            id: hash(token),
            ownerId,
            kind: "browser",
            durationMs: Date.now() - sessionStarted,
          })
          .onConflictDoUpdate({
            target: usageEvents.id,
            set: { kind: "browser", durationMs: Date.now() - sessionStarted },
          }),
      ownerId &&
        redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          `browser-owner:${ownerId}`,
          token,
        ),
    ]).finally(() => sessionCleanups.delete(settle)));
  sessionCleanups.add(settle);
  socket.on("close", () => {
    clearTimeout(expiry);
    clearTimeout(authExpiry);
    void settle();
  });
  socket.on("message", (data: Buffer) => {
    if (pendingMessages >= 100) {
      socket.close(1008, "Too many pending actions");
      return;
    }
    pendingMessages++;
    messages = messages
      .then(async () => {
        if (socket.readyState !== 1) return;
        try {
          const msg = JSON.parse(data.toString());
          if (!authenticated) {
            if (msg.type !== "authenticate" || typeof msg.token !== "string")
              throw new Error("Authentication required");
            const origin = req.headers.origin;
            if (
              origin !==
              new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
                .origin
            )
              throw new Error("Invalid origin");
            const raw = await redis.getdel(`browser-token:${hash(msg.token)}`);
            if (!raw) throw new Error("Session token expired");
            const session = JSON.parse(raw);
            ownerId = session.ownerId;
            scraperId = session.scraperId;
            token = msg.token;
            const [actor] = await db
              .select()
              .from(user)
              .where(eq(user.id, ownerId));
            if (!actor || actor.suspended) throw new Error("Account suspended");
            clearTimeout(expiry);
            expiry = setTimeout(
              () => socket.close(1000, "Browser session time limit reached"),
              session.budgetMs,
            );
            await db
              .update(usageEvents)
              .set({ kind: "browser-active" })
              .where(eq(usageEvents.id, hash(token)));
            authenticated = true;
            clearTimeout(authExpiry);
            const definition = definitionSchema.parse(session.definition);
            allowedDomains = definition.allowedDomains;
            send({ type: "notice", message: "Starting the browser…" });
            releaseLease = await leaseBrowser(
              redis,
              hash(token),
              definition.allowedDomains,
            );
            if (socket.readyState !== 1) {
              await releaseLease();
              return;
            }
            browser = await chromium.launch({
              chromiumSandbox: true,
              headless: true,
              proxy: process.env.BROWSER_PROXY
                ? { server: process.env.BROWSER_PROXY }
                : undefined,
            });
            const context = await browser.newContext({
              viewport: { width: 1280, height: 800 },
              serviceWorkers: "block",
              acceptDownloads: false,
            });
            await protectContext(
              context,
              definition.allowedDomains,
              blocked,
              !!process.env.BROWSER_PROXY,
            );
            const [saved] = await db
              .select()
              .from(browserSessions)
              .where(
                and(
                  eq(browserSessions.ownerId, ownerId),
                  eq(browserSessions.scraperId, scraperId),
                  sql`${browserSessions.expiresAt}>now()`,
                ),
              );
            if (saved) {
              const state = JSON.parse(
                decrypt(saved.encrypted, `${ownerId}:session:${scraperId}`),
              );
              await context.addCookies(state.cookies ?? []);
            }
            page = await context.newPage();
            page.on("requestfailed", (request: any) => {
              if (
                request.isNavigationRequest() &&
                request.frame() === page.mainFrame() &&
                request.failure()?.errorText.includes("BLOCKED_BY_CLIENT")
              )
                send({
                  type: "error",
                  message: `Blocked opening ${new URL(request.url()).hostname}: this scraper may only open ${allowedDomains.join(", ")}. Add the domain to allowedDomains in Definition if you are authorized to automate it.`,
                });
            });
            const cdp = await context.newCDPSession(page);
            cdp.on("Page.screencastFrame", async (event: any) => {
              send({ type: "frame", data: event.data });
              await cdp
                .send("Page.screencastFrameAck", { sessionId: event.sessionId })
                .catch(() => {});
            });
            await cdp.send("Page.startScreencast", {
              format: "jpeg",
              quality: 65,
              maxWidth: 1280,
              maxHeight: 800,
              everyNthFrame: 1,
            });
            page.on("framenavigated", (frame: any) => {
              if (frame === page.mainFrame())
                send({ type: "url", url: page.url() });
            });
            send({ type: "ready" });
            const first = definition.steps.find((s) => s.type === "navigate");
            if (first?.type === "navigate" && !first.url.includes("{{")) {
              await assertPublicUrl(
                first.url,
                definition.allowedDomains,
                viaProxy,
              );
              await throttle(first.url);
              await page
                .goto(first.url, { waitUntil: "domcontentloaded" })
                .catch((e: Error) =>
                  send({
                    type: "error",
                    message: `Could not open ${first.url}: ${e.message.split("\n")[0]}`,
                  }),
                );
            }
            return;
          }
          if (msg.type === "saveSession") {
            const state = await page.context().storageState();
            await db
              .insert(browserSessions)
              .values({
                id: randomUUID(),
                ownerId,
                scraperId,
                encrypted: encrypt(
                  JSON.stringify(state),
                  `${ownerId}:session:${scraperId}`,
                ),
                expiresAt: new Date(Date.now() + 7 * 86400000),
              })
              .onConflictDoUpdate({
                target: [browserSessions.ownerId, browserSessions.scraperId],
                set: {
                  encrypted: encrypt(
                    JSON.stringify(state),
                    `${ownerId}:session:${scraperId}`,
                  ),
                  expiresAt: new Date(Date.now() + 7 * 86400000),
                },
              });
            send({
              type: "notice",
              message: "Encrypted login session saved for up to seven days.",
            });
          }
          if (msg.type === "navigate") {
            await assertPublicUrl(msg.url, allowedDomains, viaProxy).catch((e: Error) => {
              throw new Error(
                e.message === "Domain is not declared in this scraper"
                  ? `${new URL(msg.url).hostname} is not an allowed domain for this scraper (allowed: ${allowedDomains.join(", ")}). Add it to allowedDomains in Definition if you are authorized to automate it.`
                  : e.message,
              );
            });
            await throttle(msg.url);
            await page.goto(msg.url, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
          }
          if (msg.type === "mode")
            mode = msg.mode === "select" ? "select" : "interact";
          if (msg.type === "container")
            container = String(msg.selector).slice(0, 1000);
          if (msg.type === "preview") {
            const definition = definitionSchema.parse(msg.definition);
            const collections = definition.steps.filter(
              (s) => s.type === "extractCollection",
            );
            const step =
              collections.find((s) => s.id === msg.stepId) ?? collections[0];
            if (step?.type !== "extractCollection")
              throw new Error(
                "Add a collection with at least one output field to preview.",
              );
            const preview = await previewCollection(page, step).catch(
              (e: Error) => {
                throw new Error(`Preview failed: ${e.message.split("\n")[0]}`);
              },
            );
            send({ type: "preview", stepId: step.id, ...preview });
          }
          // Recorded Fill, Click and Choose option steps are also done live, so a flow can be recorded as it is used.
          if (msg.type === "perform") {
            const step = msg.step ?? {};
            if (!["fill", "click", "select"].includes(step.type) || typeof step.locator?.primary !== "string")
              throw new Error("Only Fill, Click and Choose option steps can be done in the browser.");
            try {
              const target = (
                await locate(page, {
                  primary: step.locator.primary.slice(0, 1000),
                  fallbacks: [],
                  frame: typeof step.locator.frame === "string" ? step.locator.frame : undefined,
                })
              ).first();
              const value = String(step.value ?? "").slice(0, 4096);
              if (step.type === "fill") await target.fill(value, { timeout: 10000 });
              if (step.type === "select") await target.selectOption(value, { timeout: 10000 });
              if (step.type === "click") {
                await target.click({ timeout: 10000 });
                await page.waitForLoadState("domcontentloaded").catch(() => {});
              }
              send({
                type: "notice",
                message:
                  step.type === "fill"
                    ? "Recorded and filled in the browser."
                    : step.type === "select"
                      ? `Recorded and chose "${value}" in the browser.`
                      : "Recorded and clicked in the browser.",
              });
            } catch (e) {
              throw new Error(
                `The step was recorded, but it did not work in this browser: ${(e as Error).message.split("\n")[0]}`,
              );
            }
          }
          if (msg.type === "type") {
            if (typeof msg.text !== "string" || msg.text.length > 4096)
              throw new Error("Text too long");
            await page.keyboard.insertText(msg.text);
          }
          if (
            msg.type === "key" &&
            [
              "Enter",
              "Tab",
              "Backspace",
              "Escape",
              "ArrowDown",
              "ArrowUp",
            ].includes(msg.key)
          )
            await page.keyboard.press(msg.key);
          if (msg.type === "scroll")
            await page.mouse.wheel(
              0,
              Math.max(-1000, Math.min(1000, Number(msg.deltaY) || 0)),
            );
          if (["pointer", "hover", "inspect"].includes(msg.type)) {
            // Newer input already supersedes this hover; skipping keeps clicks responsive.
            if (msg.type === "hover" && pendingMessages > 1) return;
            const x = Number(msg.x),
              y = Number(msg.y);
            if (
              !Number.isFinite(x) ||
              !Number.isFinite(y) ||
              x < 0 ||
              y < 0 ||
              x > 1280 ||
              y > 800
            )
              return;
            // "inspect" re-reads a point after the collection changes, whatever the mode.
            if (mode === "interact" && msg.type !== "inspect") {
              if (msg.type === "pointer") await page.mouse.click(x, y);
            } else {
              const picked = await inspect(
                page,
                x,
                y,
                container,
                msg.type === "hover",
              );
              if (msg.type === "hover") return;
              if (picked) send({ type: "selection", via: msg.type, ...picked });
              else
                send({
                  type: "notice",
                  message:
                    "Nothing selectable at that point. Click on text, an image or a link.",
                });
            }
          }
        } catch (e) {
          // Playwright errors carry multi-line call logs; the first line is the part people can act on.
          send({
            type: "error",
            message:
              explainDefinitionError(e).split("\n")[0] || "Browser action failed",
          });
          if (!authenticated || !page)
            socket.close(1011, "Browser session could not start");
        }
      })
      .finally(() => {
        pendingMessages--;
      });
  });
});
const queue = new Queue("runs", { connection });
const reconciler = setInterval(() => {
  reconcile(queue, deliveryQueue).catch((e) =>
    app.log.error({ name: e.name }, "Reconciliation failed"),
  );
}, 30000);
const cleanup = setInterval(() => {
  applyRetention(artifactStore).catch((e) =>
    app.log.error({ name: e.name }, "Cleanup failed"),
  );
}, 3600000);
await app.listen({ port: 3001, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(reconciler);
    clearInterval(cleanup);
    // Settle open browser sessions first: recording usage and releasing leases need Redis and PostgreSQL.
    await Promise.allSettled([...sessionCleanups].map((settle) => settle()));
    await app.close();
    await worker.close();
    await queue.close();
    await deliveryQueue.close();
    await redis.quit();
    await client.end();
    process.exit(0);
  });
