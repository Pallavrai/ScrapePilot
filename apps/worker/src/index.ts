import Fastify from "fastify";
import { leaseBrowser } from "./lease";
import { LocalArtifactStore } from "@scrapepilot/scraper-engine/artifacts";
import { inspect } from "./selection";
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
import { definitionSchema } from "@scrapepilot/contracts";
import { execute, chromium, protectContext } from "@scrapepilot/scraper-engine";
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
          {
            jobId: `${run.id}-${hook.id}`,
            attempts: 4,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        );
      completed.inc({ status: result.status });
    } catch {
      throw new Error("Run failed");
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
worker.on("failed", (job) => {
  if (!job) return;
  void db
    .transaction(async (tx) => {
      const [failed] = await tx
        .update(runs)
        .set({
          status: "failed",
          error: {
            message: "Worker execution failed. Contact the administrator.",
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
    authenticated = false;
  let messages = Promise.resolve();
  let pendingMessages = 0;
  const sessionStarted = Date.now();
  let releaseLease = async () => {};
  let expiry = setTimeout(() => socket.close(), 900000);
  const authExpiry = setTimeout(() => {
    if (!authenticated) socket.close();
  }, 10000);
  const send = (data: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(data));
  };
  socket.on("close", () => {
    clearTimeout(expiry);
    clearTimeout(authExpiry);
    void browser?.close();
    void releaseLease();
    if (ownerId)
      void db
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
        })
        .catch(() => {});
    if (ownerId)
      void redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        `browser-owner:${ownerId}`,
        token,
      );
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
            expiry = setTimeout(() => socket.close(), session.budgetMs);
            await db
              .update(usageEvents)
              .set({ kind: "browser-active" })
              .where(eq(usageEvents.id, hash(token)));
            authenticated = true;
            clearTimeout(authExpiry);
            const definition = definitionSchema.parse(session.definition);
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
            await protectContext(context, definition.allowedDomains, blocked);
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
              await assertPublicUrl(first.url, definition.allowedDomains);
              await throttle(first.url);
              await page.goto(first.url, { waitUntil: "domcontentloaded" });
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
            await assertPublicUrl(msg.url);
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
          if (msg.type === "pointer" || msg.type === "hover") {
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
            if (mode === "interact") {
              if (msg.type === "pointer") await page.mouse.click(x, y);
            } else {
              const picked = await inspect(page, x, y, container);
              if (msg.type === "pointer" && picked)
                send({ type: "selection", ...picked });
            }
          }
        } catch (e) {
          send({
            type: "error",
            message: e instanceof Error ? e.message : "Browser action failed",
          });
          if (!authenticated || !page) socket.close();
        }
      })
      .finally(() => {
        pendingMessages--;
      });
  });
});
// Reconcile DB-backed queued jobs after a Redis outage or failed enqueue.
const queue = new Queue("runs", { connection });
const reconcile = setInterval(() => {
  void (async () => {
    await db.execute(
      sql`update usage_events set duration_ms=0,kind='browser-expired' where kind='browser-pending' and created_at<now()-interval '90 seconds'`,
    );
    await db.execute(sql`delete from browser_sessions where expires_at<now()`);
    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, "pending"))
      .limit(100);
    for (const delivery of deliveries)
      await deliveryQueue.add(
        "deliver",
        { webhookId: delivery.webhookId, runId: delivery.runId },
        {
          jobId: delivery.id,
          attempts: 4,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    const pending = await db
      .select()
      .from(runs)
      .where(eq(runs.status, "queued"))
      .limit(100);
    for (const run of pending)
      await queue.add(
        "execute",
        { runId: run.id },
        { jobId: run.id, removeOnComplete: 1000 },
      );
    await db
      .update(runs)
      .set({
        status: "failed",
        error: { message: "Worker lost during execution" },
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(runs.status, "running"),
          sql`${runs.startedAt}<now()-interval '20 minutes'`,
        ),
      );
  })().catch((e) => app.log.error({ name: e.name }, "Reconciliation failed"));
}, 30000);
const cleanup = setInterval(() => {
  void (async () => {
    await db.execute(
      sql`delete from result_rows where run_id in (select id from runs where created_at<now()-interval '30 days')`,
    );
    await artifactStore.prune(new Date(Date.now() - 7 * 86400000));
  })().catch((e) => app.log.error({ name: e.name }, "Cleanup failed"));
}, 3600000);
await app.listen({ port: 3001, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(reconcile);
    clearInterval(cleanup);
    await worker.close();
    await queue.close();
    await deliveryQueue.close();
    await redis.quit();
    await app.close();
    await client.end();
    process.exit(0);
  });
