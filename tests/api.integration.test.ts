import { describe, it, expect, beforeAll, afterAll,vi } from "vitest";
vi.mock('../packages/scraper-engine/src/network',()=>({publicText:async()=>({status:404,text:''}),robotsConflict:()=>false}));
import { randomUUID } from "node:crypto";
const enabled = !!process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)("PostgreSQL API tenant integration", () => {
  let store: any, route: any, server: any;
  const a = randomUUID(),
    b = randomUUID(),
    tokenA = `test-${randomUUID()}`,
    tokenB = `test-${randomUUID()}`;
  let scraperId = "",
    versionId = "",
    runId = "",
    installedId = "";
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "56379";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    store = await import("../packages/db/src/index");
    const { hash } = await import("../packages/scraper-engine/src/security");
    route = await import("../apps/web/app/api/v1/[...path]/route");
    server = await import("../apps/web/lib/server");
    await store.db.insert(store.user).values([
      {
        id: a,
        name: "Creator",
        email: `${a}@example.test`,
        emailVerified: true,
      },
      {
        id: b,
        name: "Consumer",
        email: `${b}@example.test`,
        emailVerified: true,
      },
    ]);
    await store.db.insert(store.apiKeys).values([
      {
        id: randomUUID(),
        ownerId: a,
        name: "Test",
        prefix: "test",
        hash: hash(tokenA),
      },
      {
        id: randomUUID(),
        ownerId: b,
        name: "Test",
        prefix: "test",
        hash: hash(tokenB),
      },
    ]);
  });
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    token = tokenA,
    extra: Record<string, string> = {},
  ) {
    const req = new Request(`http://localhost/api/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return route[method](req, {
      params: Promise.resolve({ path: path.split("?")[0].split("/") }),
    });
  }
  it("creates a private scraper and prevents cross-account reads and edits", async () => {
    const r = await call("scrapers", "POST", {
      url: "https://example.com",
      name: "Integration",
    });
    expect(r.status).toBe(201);
    scraperId = (await r.json()).id;
    expect(
      (await call(`scrapers/${scraperId}`, "GET", undefined, tokenB)).status,
    ).toBe(404);
    expect(
      (await call(`scrapers/${scraperId}`, "PATCH", { definition: {} }, tokenB))
        .status,
    ).toBe(404);
  });
  it("versions immutable definitions and rejects repeat active runs", async () => {
    const v = await call(`scrapers/${scraperId}/versions`, "POST", {});
    expect(v.status).toBe(201);
    versionId = (await v.json()).id;
    const r = await call(
      `scrapers/${scraperId}/runs`,
      "POST",
      { input: {} },
      tokenA,
      { "idempotency-key": "first" },
    );
    expect(r.status).toBe(202);
    runId = (await r.json()).runId;
    const again = await call(
      `scrapers/${scraperId}/runs`,
      "POST",
      { input: {} },
      tokenA,
      { "idempotency-key": "first" },
    );
    expect((await again.json()).runId).toBe(runId);
    expect(
      (
        await call(
          `scrapers/${scraperId}/runs`,
          "POST",
          { input: { searchTerm: "changed" } },
          tokenA,
          { "idempotency-key": "first" },
        )
      ).status,
    ).toBe(409);
    expect(
      (await call(`scrapers/${scraperId}/runs`, "POST", { input: {} })).status,
    ).toBe(429);
  });
  it("protects run data and cancellation from other users", async () => {
    expect((await call(`runs/${runId}`, "GET", undefined, tokenB)).status).toBe(
      404,
    );
    expect(
      (await call(`runs/${runId}/results`, "GET", undefined, tokenB)).status,
    ).toBe(404);
    expect(
      (await call(`runs/${runId}/cancel`, "POST", {}, tokenB)).status,
    ).toBe(404);
    expect((await call(`runs/${runId}/cancel`, "POST", {})).status).toBe(200);
  });
  it("requires review before installing another creator template", async () => {
    const r = await call("marketplace", "POST", {
      versionId,
      attestation: true,
      description: "Fixture",
    });
    expect(r.status).toBe(201);
    const listing = await r.json();
    expect(
      (await call(`marketplace/${listing.id}/install`, "POST", {}, tokenB))
        .status,
    ).toBe(404);
    expect(
      (
        await call("admin/listings", "POST", {
          id: listing.id,
          status: "approved",
        })
      ).status,
    ).toBe(403);
    await store.db
      .update(store.user)
      .set({ role: "admin" })
      .where(store.eq(store.user.id, a));
    expect(
      (
        await call("admin/listings", "POST", {
          id: listing.id,
          status: "approved",
        })
      ).status,
    ).toBe(200);
    const installed = await call(
      `marketplace/${listing.id}/install`,
      "POST",
      {},
      tokenB,
    );
    expect(installed.status).toBe(201);
    installedId = (await installed.json()).id;
    const own = await call(
      `scrapers/${installedId}`,
      "GET",
      undefined,
      tokenB,
    );
    expect((await own.json()).installedVersionId).toBe(versionId);
    const upToDate = await call(`scrapers/${installedId}/upgrade`, "GET", undefined, tokenB);
    expect(upToDate.status).toBe(404);
    expect((await upToDate.json()).error).toBe("You already have the latest approved version of this template.");
  });
  it("stores secrets without returning plaintext", async () => {
    expect(
      (
        await call("secrets", "POST", {
          domain: "example.com",
          name: "password",
          value: "not-in-api-response",
        })
      ).status,
    ).toBe(201);
    const r = await call("secrets");
    expect(await r.text()).not.toContain("not-in-api-response");
  });
  it("reports usage, last runs and run names for the dashboard", async () => {
    const me = await (await call("me")).json();
    expect(typeof me.usedMinutes).toBe("number");
    const scraperList = await (await call("scrapers")).json();
    // A local dev worker may already be running this job, so any run state is acceptable here.
    expect(["queued", "running", "succeeded", "partial", "blocked", "failed", "canceled"]).toContain(
      scraperList.find((s: any) => s.id === scraperId).lastRun.status,
    );
    const runList = await (await call("runs")).json();
    expect(runList.find((r: any) => r.id === runId)).toMatchObject({
      scraperName: "Integration",
      storedRows: 0,
      hasScreenshot: false,
    });
  });
  it("exports results as CSV without spreadsheet formulas", async () => {
    await store.db.insert(store.resultRows).values({
      runId,
      position: 0,
      data: { title: '=HYPERLINK("x")', price: -5, note: 'a, "b"' },
    });
    const r = await call(`runs/${runId}/results?format=csv`);
    expect(r.headers.get("content-type")).toContain("text/csv");
    // This version has no fields, so columns follow jsonb key order (length, then name).
    expect(await r.text()).toBe(
      'note,price,title\r\n"a, ""b""",-5,"\'=HYPERLINK(""x"")"\r\n',
    );
    await store.db.delete(store.resultRows).where(store.eq(store.resultRows.runId, runId));
  });
  it("validates credentials and refuses duplicates", async () => {
    expect((await call("secrets", "POST", { domain: "https://example.com/x", name: "token", value: "v" })).status).toBe(400);
    expect((await call("secrets", "POST", { domain: "example.com", name: "1bad", value: "v" })).status).toBe(400);
    expect((await call("secrets", "POST", { domain: "EXAMPLE.com", name: "password", value: "again" })).status).toBe(409);
  });
  it("refuses a run once the monthly browser quota is used up", async () => {
    expect((await call(`scrapers/${installedId}/versions`, "POST", {}, tokenB)).status).toBe(201);
    await store.db.update(store.user).set({ monthlyMinutes: 0 }).where(store.eq(store.user.id, b));
    const refused = await call(`scrapers/${installedId}/runs`, "POST", { input: {} }, tokenB);
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toBe("Monthly browser quota exhausted");
    expect(await store.db.select().from(store.runs).where(store.eq(store.runs.ownerId, b))).toHaveLength(0);
  });
  it("needs report reasons and rejection notes, and guards scraper deletion", async () => {
    const [listing] = await store.db
      .select()
      .from(store.listings)
      .where(store.eq(store.listings.versionId, versionId));
    expect((await call(`marketplace/${listing.id}/report`, "POST", { reason: "bad" }, tokenB)).status).toBe(400);
    expect((await call(`marketplace/${listing.id}/report`, "POST", { reason: "Collects data the site forbids" }, tokenB)).status).toBe(200);
    const reported = (await (await call("admin/reports")).json()).find((r: any) => r.listingId === listing.id);
    expect(reported).toMatchObject({ listingName: "Integration", reason: "Collects data the site forbids" });
    expect((await call("admin/listings", "POST", { id: listing.id, status: "rejected" })).status).toBe(400);
    expect((await call(`scrapers/${scraperId}`, "DELETE", undefined, tokenB)).status).toBe(404);
    expect((await call(`scrapers/${scraperId}`, "DELETE")).status).toBe(409);
    expect((await call("admin/listings", "POST", { id: listing.id, status: "rejected", note: "Taken down in a test" })).status).toBe(200);
    // Deleting waits for runs to settle; a local dev worker may still be finishing this one.
    for (const end = Date.now() + 60000; Date.now() < end; await new Promise((r) => setTimeout(r, 500)))
      if (!["queued", "running"].includes((await (await call(`runs/${runId}`)).json()).status)) break;
    expect((await call(`scrapers/${scraperId}`, "DELETE")).status).toBe(200);
    expect((await call(`scrapers/${scraperId}`)).status).toBe(404);
    expect((await call(`runs/${runId}`)).status).toBe(404);
    const orphan = await call(`scrapers/${installedId}/upgrade`, "GET", undefined, tokenB);
    expect(orphan.status).toBe(404);
    expect((await orphan.json()).error).toBe("The template this scraper came from is no longer available.");
  });
  afterAll(async () => {
    if (server) {
      await server.getQueue().close();
      await server.redis.quit();
    }
    if (!store) return;
    // Remove everything the two fixture users created, children before parents.
    const { db, sql } = store;
    const owned = sql`in (${a}, ${b})`;
    await db.execute(sql`delete from reports where owner_id ${owned} or listing_id in (select id from listings where owner_id ${owned})`);
    await db.execute(sql`delete from listings where owner_id ${owned}`);
    await db.execute(sql`delete from webhook_deliveries where run_id in (select id from runs where owner_id ${owned})`);
    await db.execute(sql`delete from result_rows where run_id in (select id from runs where owner_id ${owned})`);
    await db.execute(sql`delete from runs where owner_id ${owned}`);
    await db.execute(sql`delete from versions where scraper_id in (select id from scrapers where owner_id ${owned})`);
    for (const table of ["browser_sessions", "scrapers", "api_keys", "secrets", "webhooks", "usage_events", "audit_events"])
      await db.execute(sql`delete from ${sql.raw(table)} where owner_id ${owned}`);
    await db.execute(sql`delete from "user" where id ${owned}`);
    await store.client.end();
  });
});
