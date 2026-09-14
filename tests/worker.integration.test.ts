import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, utimes, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
const enabled = !!process.env.TEST_DATABASE_URL;
// Uses fixture rows of one throwaway user; run it against an isolated test database, because
// crash recovery and reconciliation act on every matching row, as the worker does.
describe.skipIf(!enabled)("worker fault recovery", () => {
  let store: any, delivery: any, maintenance: any;
  const owner = randomUUID(),
    scraperId = randomUUID(),
    versionId = randomUUID(),
    hookId = randomUUID(),
    signingKey = randomBytes(32).toString("hex"),
    runIds: string[] = [];
  const connection = () => ({
    host: "localhost",
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
  });
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "56379";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    store = await import("../packages/db/src/index");
    const { encrypt } = await import("../packages/scraper-engine/src/security");
    delivery = await import("../apps/worker/src/delivery");
    maintenance = await import("../apps/worker/src/maintenance");
    await store.db.insert(store.user).values({
      id: owner,
      name: "Worker fixture",
      email: `worker-${owner}@example.test`,
      emailVerified: true,
    });
    await store.db
      .insert(store.scrapers)
      .values({ id: scraperId, ownerId: owner, name: "Worker fixture", draft: {} });
    await store.db
      .insert(store.versions)
      .values({ id: versionId, scraperId, number: 1, definition: {} });
    await store.db.insert(store.webhooks).values({
      id: hookId,
      ownerId: owner,
      url: "https://hooks.example.test/scrapepilot",
      encryptedKey: encrypt(signingKey, `${owner}:webhook:${hookId}`),
    });
  });
  async function addRun(values: Record<string, unknown> = {}) {
    const id = randomUUID();
    runIds.push(id);
    await store.db.insert(store.runs).values({
      id,
      ownerId: owner,
      scraperId,
      versionId,
      input: {},
      requestHash: id,
      status: "succeeded",
      rowCount: 3,
      ...values,
    });
    return id;
  }
  async function addDelivery(runId: string) {
    const id = `${runId}-${hookId}`;
    await store.db
      .insert(store.webhookDeliveries)
      .values({ id, webhookId: hookId, runId })
      .onConflictDoNothing();
    return id;
  }
  const statusOf = async (id: string) =>
    (
      await store.db
        .select()
        .from(store.webhookDeliveries)
        .where(store.eq(store.webhookDeliveries.id, id))
    )[0]?.status;
  it("signs deliveries so a receiver can verify them with the documented check", async () => {
    const runId = await addRun();
    const id = await addDelivery(runId);
    let sent: { url: string; body: string; signature: string } | undefined;
    await delivery.processDelivery(
      id,
      { webhookId: hookId, runId },
      async (url: URL, body: string, signature: string) => {
        sent = { url: url.href, body, signature };
      },
    );
    expect(sent!.url).toBe("https://hooks.example.test/scrapepilot");
    expect(JSON.parse(sent!.body)).toMatchObject({
      id,
      type: "run.completed",
      runId,
      status: "succeeded",
      rowCount: 3,
    });
    // Receiver side, as on the docs page.
    const parts = Object.fromEntries(
      sent!.signature.split(",").map((p) => p.split("=")),
    );
    const expected = createHmac("sha256", signingKey)
      .update(`${parts.t}.${sent!.body}`)
      .digest("hex");
    expect(Math.abs(Date.now() / 1000 - Number(parts.t))).toBeLessThan(300);
    expect(timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))).toBe(true);
    const tampered = createHmac("sha256", signingKey)
      .update(`${parts.t}.${sent!.body.replace('"rowCount":3', '"rowCount":4')}`)
      .digest("hex");
    expect(tampered).not.toBe(parts.v1);
    expect(await statusOf(id)).toBe("delivered");
  });
  it("names the event after the run outcome", async () => {
    for (const [status, type] of [
      ["partial", "run.partial"],
      ["blocked", "run.blocked"],
      ["failed", "run.failed"],
    ]) {
      const runId = await addRun({ status });
      let body = "";
      await delivery.processDelivery(
        await addDelivery(runId),
        { webhookId: hookId, runId },
        async (_url: URL, sentBody: string) => {
          body = sentBody;
        },
      );
      expect(JSON.parse(body).type).toBe(type);
    }
  });
  it("retries a failing receiver and records delivered or failed", async () => {
    // bullmq is a dependency of the worker package, not of the repository root.
    const fromWorker = createRequire(new URL("../apps/worker/package.json", import.meta.url));
    const { Queue } = await import(fromWorker.resolve("bullmq"));
    const name = `webhooks-test-${randomUUID()}`;
    const queue = new Queue(name, { connection: connection() });
    const flakyRun = await addRun(),
      deadRun = await addRun();
    const flaky = await addDelivery(flakyRun),
      dead = await addDelivery(deadRun);
    const attempts: Record<string, number> = {};
    const worker = delivery.startDeliveryWorker(
      name,
      connection(),
      async (_url: URL, body: string) => {
        const { id } = JSON.parse(body);
        attempts[id] = (attempts[id] ?? 0) + 1;
        if (id === dead || attempts[id] < 3)
          throw new Error("Receiver returned HTTP 503");
      },
    );
    try {
      const options = { attempts: 3, backoff: { type: "fixed", delay: 20 } };
      await queue.add("deliver", { webhookId: hookId, runId: flakyRun }, { jobId: flaky, ...options });
      await queue.add("deliver", { webhookId: hookId, runId: deadRun }, { jobId: dead, ...options });
      await vi.waitFor(
        async () => {
          expect(await statusOf(flaky)).toBe("delivered");
          expect(await statusOf(dead)).toBe("failed");
        },
        { timeout: 20000, interval: 100 },
      );
      expect(attempts).toEqual({ [flaky]: 3, [dead]: 3 });
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
  it("refuses non-HTTPS and private webhook destinations before connecting", async () => {
    await expect(delivery.deliver(new URL("http://example.com/hook"), "{}", "")).rejects.toThrow("public HTTPS");
    await expect(delivery.deliver(new URL("https://example.com:8443/hook"), "{}", "")).rejects.toThrow("public HTTPS");
    await expect(delivery.deliver(new URL("https://localhost/hook"), "{}", "")).rejects.toThrow("private");
  });
  it("revokes deliveries whose webhook or run is gone instead of leaving them pending", async () => {
    const refuse = async () => {
      throw new Error("Nothing should be sent");
    };
    const withoutHook = await addDelivery(await addRun());
    await delivery.processDelivery(withoutHook, { webhookId: randomUUID(), runId: runIds.at(-1) }, refuse);
    expect(await statusOf(withoutHook)).toBe("revoked");
    const withoutRun = await addDelivery(await addRun());
    await delivery.processDelivery(withoutRun, { webhookId: hookId, runId: randomUUID() }, refuse);
    expect(await statusOf(withoutRun)).toBe("revoked");
  });
  it("requeues pending deliveries and queued runs after a Redis outage", async () => {
    const pendingRun = await addRun();
    const pending = await addDelivery(pendingRun);
    const queuedRun = await addRun({ status: "queued" });
    const added: { queue: string; data: unknown; opts: any }[] = [];
    const fake = (queue: string) => ({
      add: async (_name: string, data: unknown, opts: unknown) => {
        added.push({ queue, data, opts });
      },
    });
    try {
      await maintenance.reconcile(fake("runs"), fake("webhooks"));
    } finally {
      // Keep a live worker from picking up the fixture run.
      await store.db.update(store.runs).set({ status: "canceled" }).where(store.eq(store.runs.id, queuedRun));
    }
    expect(added).toContainEqual({
      queue: "webhooks",
      data: { webhookId: hookId, runId: pendingRun },
      opts: expect.objectContaining({ jobId: pending, attempts: 4 }),
    });
    expect(added).toContainEqual({
      queue: "runs",
      data: { runId: queuedRun },
      opts: expect.objectContaining({ jobId: queuedRun }),
    });
  });
  it("fails runs interrupted by a worker crash and charges only the time they ran", async () => {
    const recent = await addRun({ status: "running", startedAt: new Date(Date.now() - 120000) });
    const old = await addRun({ status: "running", startedAt: new Date(Date.now() - 3600000) });
    const settled = await addRun();
    await store.db.insert(store.usageEvents).values([
      { id: recent, ownerId: owner, kind: "run-reserved", durationMs: 900000 },
      { id: old, ownerId: owner, kind: "run-reserved", durationMs: 300000 },
      { id: settled, ownerId: owner, kind: "run", durationMs: 4000 },
    ]);
    await maintenance.failInterruptedRuns(1);
    const failed = await store.db.select().from(store.runs).where(store.inArray(store.runs.id, [recent, old]));
    expect(failed).toHaveLength(2);
    for (const run of failed) {
      expect(run.status).toBe("failed");
      expect(run.error.message).toContain("worker stopped");
      expect(run.finishedAt).toBeTruthy();
    }
    const usage = Object.fromEntries(
      (
        await store.db
          .select()
          .from(store.usageEvents)
          .where(store.inArray(store.usageEvents.id, [recent, old, settled]))
      ).map((u: any) => [u.id, u]),
    );
    expect(usage[recent].kind).toBe("run");
    expect(usage[recent].durationMs).toBeGreaterThanOrEqual(120000);
    expect(usage[recent].durationMs).toBeLessThan(180000);
    expect(usage[old]).toMatchObject({ kind: "run", durationMs: 300000 });
    expect(usage[settled]).toMatchObject({ kind: "run", durationMs: 4000 });
    expect(await statusOf(`${recent}-${hookId}`)).toBe("pending");
    expect(await statusOf(`${old}-${hookId}`)).toBe("pending");
  });
  it("deletes results after 30 days and failure screenshots after seven", async () => {
    const oldRun = await addRun({ createdAt: new Date(Date.now() - 31 * 86400000) });
    const newRun = await addRun();
    await store.db.insert(store.resultRows).values([
      { runId: oldRun, position: 0, data: { title: "old" } },
      { runId: newRun, position: 0, data: { title: "new" } },
    ]);
    const dir = await mkdtemp(join(tmpdir(), "scrapepilot-retention-"));
    try {
      const { LocalArtifactStore } = await import("../packages/scraper-engine/src/artifacts");
      const artifacts = new LocalArtifactStore(dir);
      const stale = randomUUID(),
        fresh = randomUUID();
      await artifacts.put(stale, "png", "stale");
      await artifacts.put(fresh, "png", "fresh");
      const eightDaysAgo = new Date(Date.now() - 8 * 86400000);
      await utimes(join(dir, `${stale}.png`), eightDaysAgo, eightDaysAgo);
      await maintenance.applyRetention(artifacts);
      const kept = await store.db
        .select()
        .from(store.resultRows)
        .where(store.inArray(store.resultRows.runId, [oldRun, newRun]));
      expect(kept.map((r: any) => r.runId)).toEqual([newRun]);
      expect(await readdir(dir)).toEqual([`${fresh}.png`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  afterAll(async () => {
    if (!store) return;
    const { db, eq, inArray } = store;
    await db.delete(store.webhookDeliveries).where(inArray(store.webhookDeliveries.runId, runIds));
    await db.delete(store.resultRows).where(inArray(store.resultRows.runId, runIds));
    await db.delete(store.usageEvents).where(eq(store.usageEvents.ownerId, owner));
    await db.delete(store.runs).where(eq(store.runs.ownerId, owner));
    await db.delete(store.webhooks).where(eq(store.webhooks.ownerId, owner));
    await db.delete(store.versions).where(eq(store.versions.scraperId, scraperId));
    await db.delete(store.scrapers).where(eq(store.scrapers.id, scraperId));
    await db.delete(store.user).where(eq(store.user.id, owner));
    await store.client.end();
  });
});
