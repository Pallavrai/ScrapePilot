import { describe, it, expect } from "vitest";
import { execute } from "../packages/scraper-engine/src/index";
import { definitionSchema } from "../packages/contracts/src/index";
const workflow = () =>
  definitionSchema.parse({
    schemaVersion: 1,
    name: "Fixture store",
    allowedDomains: ["example.com"],
    inputs: { searchTerm: { type: "text", required: true } },
    steps: [
      { id: "open", type: "navigate", url: "https://example.com/" },
      {
        id: "query",
        type: "fill",
        locator: { primary: "input[name=q]" },
        value: "{{searchTerm}}",
      },
      { id: "submit", type: "click", locator: { primary: "button" } },
      { id: "ready", type: "waitFor", locator: { primary: ".product" } },
      {
        id: "cards",
        type: "extractCollection",
        container: { primary: ".product" },
        fields: [
          { name: "title", locator: { primary: "h2" }, required: true },
          {
            name: "price",
            locator: { primary: ".price" },
            type: "number",
            required: true,
          },
          {
            name: "url",
            locator: { primary: "a" },
            source: "attribute",
            attribute: "href",
            type: "url",
            required: true,
          },
        ],
      },
      {
        id: "details",
        type: "followEach",
        linkField: "url",
        fields: [{ name: "sku", locator: { primary: ".sku" }, required: true }],
      },
    ],
    limits: { maxPages: 5, maxRows: 10, timeoutMs: 15000 },
  });
const store = `<form onsubmit="event.preventDefault();setTimeout(()=>document.querySelector('#results').innerHTML='<article class=product><h2>Nerf gun</h2><span class=price>$29.95</span><a href=/product/1>Details</a></article>',100)"><input name=q><button>Search</button></form><div id=results></div>`;
describe("real Chromium execution", () => {
  it("finishes next-page pagination when the final next button disappears", async () => {
    const d = workflow();
    d.steps = d.steps.filter((s) => ["open", "cards"].includes(s.id));
    d.steps.push({
      id: "pages",
      type: "paginate",
      mode: "next",
      next: { primary: ".next", fallbacks: [] },
      maxPages: 3,
    });
    const r = await execute(
      d,
      { searchTerm: "test" },
      {
        prepareContext: async (c) => {
          await c.route("https://example.com/**", (route) => {
            const second = route.request().url().includes("page=2");
            return route.fulfill({
              contentType: "text/html",
              body: `<article class=product><h2>Product ${second ? 2 : 1}</h2><span class=price>$10</span><a href=/product/${second ? 2 : 1}>Details</a></article>${second ? "" : '<a class=next href="/?page=2">Next</a>'}`,
            });
          });
        },
      },
    );
    expect(r.status).toBe("succeeded");
    expect(r.rows.map((row) => row.title)).toEqual(["Product 1", "Product 2"]);
  }, 30000);
  it("searches dynamic results and follows detail links", async () => {
    const result = await execute(
      workflow(),
      { searchTerm: "nerf gun" },
      {
        prepareContext: async (context) => {
          await context.route("https://example.com/**", (route) =>
            route.fulfill({
              contentType: "text/html",
              body: route.request().url().includes("/product/")
                ? "<strong class=sku>NERF-001</strong>"
                : store,
            }),
          );
        },
      },
    );
    expect(result.status, JSON.stringify(result.error)).toBe("succeeded");
    expect(result.rows).toEqual([
      {
        title: "Nerf gun",
        price: 29.95,
        url: "https://example.com/product/1",
        sku: "NERF-001",
      },
    ]);
  }, 30000);
  it("marks forbidden responses blocked without retry storms", async () => {
    let requests = 0;
    const d = workflow();
    d.steps = d.steps.slice(0, 1);
    const r = await execute(
      d,
      { searchTerm: "nerf gun" },
      {
        prepareContext: async (c) => {
          await c.route("https://example.com/**", (route) => {
            requests++;
            return route.fulfill({ status: 403, body: "Blocked" });
          });
        },
      },
    );
    expect(r.status).toBe("blocked");
    expect(requests).toBe(1);
  }, 30000);
  it("cancels an active browser", async () => {
    const d = workflow();
    d.steps = [
      d.steps[0],
      {
        id: "wait",
        type: "waitFor",
        locator: { primary: ".never", fallbacks: [] },
      },
    ];
    const controller = new AbortController();
    const pending = execute(
      d,
      { searchTerm: "test" },
      {
        signal: controller.signal,
        prepareContext: async (c) => {
          await c.route("https://example.com/**", (r) =>
            r.fulfill({ body: "<p>Waiting</p>" }),
          );
          setTimeout(() => controller.abort(), 400);
        },
      },
    );
    expect((await pending).status).toBe("canceled");
  }, 30000);
  it("repairs a changed selector using its configured fallback", async () => {
    const d = workflow();
    d.steps = d.steps.filter(
      (s) => !["query", "submit", "ready", "details"].includes(s.id),
    );
    const card = d.steps.find((s) => s.type === "extractCollection");
    if (card?.type === "extractCollection")
      card.container = { primary: ".old-product", fallbacks: [".product"] };
    const r = await execute(
      d,
      { searchTerm: "test" },
      {
        prepareContext: async (c) => {
          await c.route("https://example.com/**", (route) =>
            route.fulfill({
              body: "<article class=product><h2>New design</h2><span class=price>$10</span><a href=/product/1>Details</a></article>",
            }),
          );
        },
      },
    );
    expect(r.status).toBe("succeeded");
    expect(r.rows[0].title).toBe("New design");
  }, 30000);
});
import { chromium, previewCollection } from "../packages/scraper-engine/src/index";
import { stepSchema } from "../packages/contracts/src/index";
describe("collection diagnostics", () => {
  const fields = [
    { name: "title", locator: { primary: "h2", fallbacks: [] }, source: "text" as const, type: "string" as const, trim: true, required: true },
    { name: "rating", locator: { primary: ".rating", fallbacks: [] }, source: "text" as const, type: "string" as const, trim: true, required: false },
  ];
  it("names the failing item and field without waiting on missing optional fields", async () => {
    const d = workflow();
    d.steps = [d.steps[0], { id: "cards", type: "extractCollection", container: { primary: ".product", fallbacks: [] }, fields }];
    const started = Date.now();
    const r = await execute(d, { searchTerm: "x" }, {
      prepareContext: async (c) => {
        await c.route("https://example.com/**", (route) =>
          route.fulfill({ contentType: "text/html", body: ["A", "B", "C"].map((t) => `<article class=product><h2>${t}</h2></article>`).join("") + "<article class=product><p>No title</p></article>" }),
        );
      },
    });
    // Four items lacked the optional rating; each used to wait five seconds.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.status).toBe("partial");
    expect(r.rows).toHaveLength(3);
    expect(r.error?.message).toBe('Item 4 of 4: Field "title": No element matches "h2"');
  }, 30000);
  it("previews the first items with per-item errors", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent("<article class=product><h2>A</h2></article><article class=product></article>");
      const step = stepSchema.parse({ id: "cards", type: "extractCollection", container: { primary: ".product" }, fields });
      expect(await previewCollection(page, step as any)).toEqual({
        total: 2,
        rows: [{ title: "A", rating: null }, { _error: 'Item 2: Field "title": No element matches "h2"' }],
      });
    } finally {
      await browser.close();
    }
  }, 30000);
});
describe("late and lazily loaded content", () => {
  const collect = { id: "items", type: "extractCollection" as const, container: { primary: ".product", fallbacks: [] }, fields: [{ name: "title", locator: { primary: "h2", fallbacks: [] }, source: "text" as const, type: "string" as const, trim: true, required: true }] };
  const serve = (body: string) => async (c: any) => {
    await c.route("https://example.com/**", (route: any) => route.fulfill({ contentType: "text/html", body }));
  };
  it("waits longer than five seconds for a Wait for step", async () => {
    const d = workflow();
    d.steps = [d.steps[0], { id: "late", type: "waitFor", locator: { primary: ".product", fallbacks: [] } }, collect];
    d.limits.timeoutMs = 25000;
    const r = await execute(d, { searchTerm: "x" }, {
      prepareContext: serve(`<div id=list></div><script>setTimeout(() => document.getElementById("list").innerHTML = "<article class=product><h2>Late</h2></article>", 7000)</script>`),
    });
    expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
    expect(r.rows).toEqual([{ title: "Late" }]);
  }, 30000);
  it("keeps scrolling when new items take longer than a moment to load", async () => {
    const d = workflow();
    d.steps = [d.steps[0], collect, { id: "scroll", type: "paginate", mode: "scroll", maxPages: 2 }];
    const items = (from: number) => [0, 1, 2].map((i) => `<article class=product><h2>Item ${from + i}</h2></article>`).join("");
    const r = await execute(d, { searchTerm: "x" }, {
      prepareContext: serve(`<div id=list>${items(1)}</div><div style="height:4000px"></div><script>let loading = false; addEventListener("scroll", () => { if (loading) return; loading = true; setTimeout(() => document.getElementById("list").insertAdjacentHTML("beforeend", ${JSON.stringify(items(4))}), 1500); });</script>`),
    });
    expect(r.status, JSON.stringify(r.error)).toBe("succeeded");
    expect(r.rows.map((row) => row.title)).toEqual(["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]);
  }, 30000);
});
