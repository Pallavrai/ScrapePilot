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
    runId = "";
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
      params: Promise.resolve({ path: path.split("/") }),
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
    const own = await call(
      `scrapers/${(await installed.json()).id}`,
      "GET",
      undefined,
      tokenB,
    );
    expect((await own.json()).installedVersionId).toBe(versionId);
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
  afterAll(async () => {
    if (server) {
      await server.getQueue().close();
      await server.redis.quit();
    }
    if (store) await store.client.end();
  });
});
