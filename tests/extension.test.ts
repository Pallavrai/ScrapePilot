import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, execute } from "../packages/scraper-engine/src/index";
import { definitionSchema } from "../packages/contracts/src/index";
const enabled = !!process.env.TEST_DATABASE_URL;
type Context = Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
type Route = Parameters<Parameters<Context["route"]>[1]>[0];
const product = (title: string, price: number, sort: string) =>
  `<article class=product data-sort=${sort}><h2>${title}</h2><span class=price>$${price}</span><a href=/product/${title.replace(/\W/g, "")}>Details</a></article>`;
/** A small store: a search form that loads a results page, delayed results, two pages and a repeated item. */
function fixture(route: Route) {
  const url = new URL(route.request().url()),
    html = (body: string, status = 200) =>
      route.fulfill({ status, contentType: "text/html", body });
  if (url.pathname === "/")
    return html(
      `<form action=/search><select name=sort><option value=price>Price</option><option value=name>Name</option></select><input name=q><button>Search</button></form>`,
    );
  if (url.pathname === "/search") {
    const q = url.searchParams.get("q") ?? "",
      sort = url.searchParams.get("sort") ?? "",
      second = url.searchParams.get("page") === "2";
    const items = second
      ? product(`${q} B`, 12, sort) + product(`${q} C`, 13.5, sort)
      : product(`${q} A`, 11, sort) + product(`${q} B`, 12, sort);
    const next = second ? "" : `<a class=next href="/search?q=${q}&sort=${sort}&page=2">Next</a>`;
    return html(
      `<div id=results></div>${next}<script>setTimeout(()=>{document.querySelector('#results').innerHTML=${JSON.stringify(items)}},300)</script>`,
    );
  }
  if (url.pathname === "/feed")
    // Three more items each time the reader scrolls to the bottom, up to nine.
    return html(
      `<style>article{height:400px}</style><main></main><script>let n=0;const more=()=>{for(let i=0;i<3&&n<9;i++,n++)document.querySelector('main').insertAdjacentHTML('beforeend','<article class=product data-sort=feed><h2>Post '+(n+1)+'</h2><span class=price>$'+(n+1)+'</span><a href=/post/'+(n+1)+'>Open</a></article>')};more();addEventListener('scroll',()=>{if(innerHeight+scrollY>=document.body.scrollHeight-5)setTimeout(more,200)})</script>`,
    );
  if (url.pathname === "/limited") return html("Too many requests", 429);
  return html("Not found", 404);
}
const fields = [
  { name: "title", locator: { primary: "h2" }, required: true },
  { name: "price", locator: { primary: ".price" }, type: "number", required: true },
  { name: "url", locator: { primary: "a" }, source: "attribute", attribute: "href", type: "url" },
  { name: "sort", locator: { primary: ":scope" }, source: "attribute", attribute: "data-sort" },
];
const store_ = (extra: object = {}) =>
  definitionSchema.parse({
    schemaVersion: 1,
    name: "Extension store",
    allowedDomains: ["example.com"],
    inputs: { searchTerm: { type: "text", required: true } },
    steps: [
      { id: "open", type: "navigate", url: "https://example.com/" },
      { id: "sort", type: "select", locator: { primary: "select[name=sort]" }, value: "Name" },
      { id: "query", type: "fill", locator: { primary: "input[name=q]" }, value: "{{searchTerm}}" },
      { id: "submit", type: "click", locator: { primary: "button" } },
      { id: "ready", type: "waitFor", locator: { primary: ".product" } },
      { id: "cards", type: "extractCollection", container: { primary: ".product" }, fields },
      { id: "pages", type: "paginate", mode: "next", next: { primary: ".next" }, maxPages: 3 },
    ],
    limits: { maxPages: 5, maxRows: 50, timeoutMs: 60000 },
    ...extra,
  });
const feed = () =>
  definitionSchema.parse({
    schemaVersion: 1,
    name: "Extension feed",
    allowedDomains: ["example.com"],
    steps: [
      { id: "open", type: "navigate", url: "https://example.com/feed" },
      { id: "posts", type: "extractCollection", container: { primary: ".product" }, fields },
      { id: "more", type: "paginate", mode: "scroll", maxPages: 5 },
    ],
    limits: { maxPages: 5, maxRows: 50, timeoutMs: 60000 },
  });
describe.skipIf(!enabled)("Chrome extension runs in the person's own browser", () => {
  let store: any, route: any, maintenance: any, apiServer: any;
  let server: http.Server, base = "", context: Context, extensionId = "";
  const owner = randomUUID(),
    token = `test-${randomUUID()}`,
    blockedDomain = `x${owner.slice(0, 8)}.example.net`,
    temp: string[] = [];
  const api = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  async function scraper(definition: object) {
    const id = randomUUID(),
      parsed = definitionSchema.parse(definition);
    await store.db.insert(store.scrapers).values({ id, ownerId: owner, name: parsed.name, draft: parsed });
    await store.db.insert(store.versions).values({ id: randomUUID(), scraperId: id, number: 1, definition: parsed });
    return id;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "56379";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    store = await import("../packages/db/src/index");
    const { hash } = await import("../packages/scraper-engine/src/security");
    route = await import("../apps/web/app/api/v1/[...path]/route");
    apiServer = await import("../apps/web/lib/server");
    maintenance = await import("../apps/worker/src/maintenance");
    await store.db.insert(store.user).values({
      id: owner,
      name: "Extension user",
      email: `${owner}@example.test`,
      emailVerified: true,
    });
    await store.db.insert(store.apiKeys).values({
      id: randomUUID(),
      ownerId: owner,
      name: "Test",
      prefix: "test",
      hash: hash(token),
    });
    // The API route handler behind a real HTTP server, and a stand-in for the connect page.
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url!, base);
      if (url.pathname === "/extension/connect")
        return void res.writeHead(200, { "content-type": "text/html" }).end(
          `<script>addEventListener("message",e=>{if(e.data?.source==="scrapepilot-extension"&&e.data.type==="connected")document.title=JSON.stringify(e.data)});postMessage({source:"scrapepilot-page",type:"connect",token:${JSON.stringify(token)}},location.origin)</script>`,
        );
      const handler = route[req.method as "GET"];
      if (!url.pathname.startsWith("/api/v1/") || !handler) return void res.writeHead(404).end();
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const response: Response = await handler(
        new Request(url, {
          method: req.method,
          headers: {
            authorization: String(req.headers.authorization ?? ""),
            "content-type": "application/json",
          },
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
        { params: Promise.resolve({ path: url.pathname.slice("/api/v1/".length).split("/") }) },
      );
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" });
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { buildExtension } = await import("../apps/extension/build");
    const [built, profile] = await Promise.all([
      mkdtemp(join(tmpdir(), "scrapepilot-extension-")),
      mkdtemp(join(tmpdir(), "scrapepilot-profile-")),
    ]);
    temp.push(built, profile);
    await buildExtension({
      server: base,
      out: built,
      grantedSites: ["https://example.com/*", "http://example.com/*"],
    });
    // Extensions need the full Chromium build; its new headless mode runs them.
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${built}`, `--load-extension=${built}`],
    });
    await context.route("https://example.com/**", fixture);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    extensionId = new URL(worker.url()).host;
  }, 60000);
  afterAll(async () => {
    await context?.close();
    await new Promise((resolve) => server?.close(resolve));
    await Promise.all(temp.map((dir) => rm(dir, { recursive: true, force: true })));
    if (apiServer) {
      await apiServer.getQueue().close();
      await apiServer.redis.quit();
    }
    if (!store) return;
    const { db, sql } = store;
    await db.execute(sql`delete from webhook_deliveries where run_id in (select id from runs where owner_id = ${owner})`);
    await db.execute(sql`delete from runs where owner_id = ${owner}`);
    await db.execute(sql`delete from usage_events where owner_id = ${owner}`);
    await db.execute(sql`delete from versions where scraper_id in (select id from scrapers where owner_id = ${owner})`);
    await db.execute(sql`delete from scrapers where owner_id = ${owner}`);
    await db.execute(sql`delete from api_keys where owner_id = ${owner}`);
    await db.execute(sql`delete from policies where domain = ${blockedDomain}`);
    await db.execute(sql`delete from "user" where id = ${owner}`);
    await store.client.end();
  });
  it("connects through the connect page without showing the key", async () => {
    const page = await context.newPage();
    await page.goto(`${base}/extension/connect`);
    await expect.poll(() => page.title(), { timeout: 10000 }).toContain("connected");
    expect(JSON.parse(await page.title())).toMatchObject({ ok: true, email: `${owner}@example.test` });
    await page.close();
  });
  /** Runs a scraper from the popup with one click, waits for it to finish, and returns its run and rows. */
  async function runFromPopup(name: string, input?: string) {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const card = popup.locator("li", { hasText: name });
    await card.getByRole("button", { name: "Run" }).click();
    if (input !== undefined) {
      await card.getByLabel("searchTerm").fill(input);
      await card.getByRole("button", { name: "Start run" }).click();
    }
    // The card of an earlier run stays until this one starts, so match this scraper's card.
    const status = popup.locator(".run", { hasText: name }).locator(".status");
    await expect
      .poll(() => status.textContent({ timeout: 1000 }).catch(() => null), { timeout: 60000 })
      .toMatch(/succeeded|partial|blocked|failed|canceled/);
    const message = await popup.locator(".run p").textContent();
    await popup.close();
    for (const tab of context.pages()) if (tab.url().startsWith("https://example.com")) await tab.close();
    const runs = (await api("runs")).data.filter((r: any) => r.scraperName === name);
    const results = await api(`runs/${runs[0].id}/results`);
    return { run: runs[0], rows: results.data.rows, message };
  }
  it("runs a saved scraper from the popup and stores the same rows as a cloud run", async () => {
    const definition = store_();
    await scraper(definition);
    const cloud = await execute(definition, { searchTerm: "nerf" }, {
      prepareContext: async (c) => void (await c.route("https://example.com/**", fixture)),
    });
    expect(cloud.status).toBe("succeeded");
    const { run, rows, message } = await runFromPopup("Extension store", "nerf");
    expect(message).toBe("Saved 3 rows to your ScrapePilot account");
    expect(run).toMatchObject({ status: "succeeded", source: "browser", rowCount: 3 });
    expect(rows.map((row: any) => row.title)).toEqual(["nerf A", "nerf B", "nerf C"]);
    expect(rows[0]).toEqual({ title: "nerf A", price: 11, url: "https://example.com/product/nerfA", sort: "name" });
    expect(rows).toEqual(cloud.rows);
  }, 90000);
  it("collects an infinite-scroll feed like a cloud run", async () => {
    await scraper(feed());
    const cloud = await execute(feed(), {}, {
      prepareContext: async (c) => void (await c.route("https://example.com/**", fixture)),
    });
    const { run, rows } = await runFromPopup("Extension feed");
    expect(run.status).toBe("succeeded");
    expect(rows).toHaveLength(9);
    expect(rows).toEqual(cloud.rows);
  }, 90000);
  it("ends as blocked when the site answers HTTP 429", async () => {
    await scraper({ ...feed(), name: "Extension limited", steps: [{ id: "open", type: "navigate", url: "https://example.com/limited" }, feed().steps[1]] });
    const { run } = await runFromPopup("Extension limited");
    expect(run).toMatchObject({ status: "blocked", error: { message: "Target returned HTTP 429", stepId: "open" } });
  }, 90000);
  it("refuses runs that need stored credentials, detail pages or a blocked site", async () => {
    const login = await scraper(
      store_({ name: "Needs login", steps: [...store_().steps.slice(0, 2), { id: "pw", type: "fill", locator: { primary: "#pw" }, value: "{{secret.password}}" }] }),
    );
    expect((await api(`scrapers/${login}/browser-runs`, "POST", { input: { searchTerm: "x" } })).data.error).toMatch(/stored credentials/);
    const detail = await scraper(
      store_({ name: "Needs details", steps: [...store_().steps.slice(0, 6), { id: "more", type: "followEach", linkField: "url", fields: [{ name: "sku", locator: { primary: ".sku" } }] }] }),
    );
    const refused = await api(`scrapers/${detail}/browser-runs`, "POST", { input: { searchTerm: "x" } });
    expect(refused).toMatchObject({ status: 400, data: { error: expect.stringMatching(/Detail pages/) } });
    await store.db.insert(store.policies).values({ domain: blockedDomain, blocked: true });
    const blocked = await scraper(store_({ name: "Blocked site", allowedDomains: [blockedDomain] }));
    expect((await api(`scrapers/${blocked}/browser-runs`, "POST", { input: { searchTerm: "x" } })).status).toBe(403);
    expect((await api(`scrapers/${blocked}/browser-runs`, "POST", {})).data.error).toBe("Missing input: searchTerm");
  });
  it("keeps uploaded rows to the scraper's fields, skips duplicates and caps the row count", async () => {
    const id = await scraper(store_({ name: "Upload rules", deduplicationKey: "title", limits: { maxPages: 5, maxRows: 3, timeoutMs: 60000 } }));
    const { data: started } = await api(`scrapers/${id}/browser-runs`, "POST", { input: { searchTerm: "x" } });
    const upload = (rows: unknown[]) => api(`runs/${started.runId}/rows`, "POST", { rows });
    expect((await upload([{ title: "A", secret: "x" }])).status).toBe(400);
    expect((await upload([{ title: { nested: true } }])).status).toBe(400);
    expect((await upload([{ title: "A", price: 1 }, { title: "A", price: 2 }, { title: "B" }])).data).toEqual({ added: 2, rowCount: 2, limit: null });
    expect((await upload([{ title: "B" }, { title: "C" }, { title: "D" }])).data).toEqual({ added: 1, rowCount: 3, limit: "rows" });
    const finished = await api(`runs/${started.runId}/finish`, "POST", { status: "failed", error: { message: "Item 4 of 4: Field \"price\": missing" } });
    expect(finished.data).toMatchObject({ status: "partial", rowCount: 3, error: { message: "Item 4 of 4: Field \"price\": missing" } });
    expect((await upload([{ title: "E" }])).data.error).toBe("This run has already finished.");
    expect((await api(`runs/${started.runId}/results`)).data.rows).toEqual([{ title: "A", price: 1 }, { title: "B" }, { title: "C" }]);
    expect((await api(`runs/${started.runId}/finish`, "POST", { status: "succeeded" })).status).toBe(409);
  });
  it("lets a cloud run start beside a browser run, and cancels a browser run from Run history", async () => {
    const id = await scraper(store_({ name: "Side by side" }));
    const { data: browser } = await api(`scrapers/${id}/browser-runs`, "POST", { input: { searchTerm: "x" } });
    const cloud = await api(`scrapers/${id}/runs`, "POST", { input: { searchTerm: "x" } });
    expect(cloud.status).toBe(202);
    await api(`runs/${cloud.data.runId}/cancel`, "POST", {});
    await api(`runs/${browser.runId}/cancel`, "POST", {});
    expect((await api(`runs/${browser.runId}`)).data.status).toBe("canceled");
    expect(await api(`runs/${browser.runId}/rows`, "POST", { rows: [{ title: "A" }] })).toMatchObject({
      status: 409,
      data: { error: "This run was canceled." },
    });
  });
  it("gives up on a browser run only after 20 minutes without finishing, keeping its rows", async () => {
    const id = await scraper(store_({ name: "Went quiet" }));
    const start = () => api(`scrapers/${id}/browser-runs`, "POST", { input: { searchTerm: "x" } }).then((r) => r.data.runId);
    const [quiet, recent] = [await start(), await start()];
    await api(`runs/${quiet}/rows`, "POST", { rows: [{ title: "A" }] });
    const { db, sql } = store;
    await db.execute(sql`update runs set started_at = now() - interval '25 minutes' where id = ${quiet}`);
    await db.execute(sql`update runs set started_at = now() - interval '10 minutes' where id = ${recent}`);
    await maintenance.failInterruptedRuns(1);
    expect((await api(`runs/${quiet}`)).data).toMatchObject({
      status: "partial",
      error: { message: "The browser stopped sending updates during this run. Start the run again." },
    });
    expect((await api(`runs/${recent}`)).data.status).toBe("running");
  });
});
