import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Amazon-like results: the title sits 16 levels below its card, carries a per-product
// aria-label, shares class-less <span>s with other card text, and its column shares
// classes with the image column.
const card = (n: number) =>
  `<div data-component-type="s-search-result" class="s-result-item"><span>Sponsored</span>${"<div class=wrap>".repeat(12)}<div class="col"><div class="col-inner"><span>Image ${n}</span></div></div><div class="col"><div class="col-inner" style="padding:20px"><a class="a-link-normal" href="/dp/${n}"><h2 class="a-size-medium" aria-label="Product ${n} with a long marketing title"><span>Product ${n}</span></h2></a><span class="a-price-whole">${n}99</span></div></div>${"</div>".repeat(12)}</div>`;
const fixture = `<div class="s-main-slot"><div class="s-result-item">Results</div>${[1, 2, 3].map(card).join("")}</div>`;
const cards = 'div[data-component-type="s-search-result"]';
// A value two iframes deep; each srcdoc level escapes the HTML of the level inside it.
const deepest = `<p class="deep">Deep value</p>`;
const middle = `<h3>Outer</h3><iframe id="inner" style="width:400px;height:200px;border:0" srcdoc="${deepest.replaceAll('"', "&quot;")}"></iframe>`;
const nested = `<h1>Top</h1><iframe id="outer" style="width:600px;height:400px;border:0" srcdoc="${middle.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe>`;
const source = (path: string) => JSON.stringify(pathToFileURL(resolve(path)).href);
// Runs under tsx like the worker: its esbuild keepNames transform once broke the
// in-page picker with "__name is not defined", which Vitest's own transform hides.
const probe = `
import { chromium, locate } from ${source("packages/scraper-engine/src/index.ts")};
import { inspect } from ${source("apps/worker/src/selection.ts")};
const browser = await chromium.launch();
const textsIn = (page, collection, rel) =>
  page.$$eval(collection, (items, rel) => items.map((item) => item.querySelector(rel)?.textContent), rel);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(process.env.FIXTURE);
  const box = await page.locator("h2 span").first().boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const plain = await inspect(page, x, y, "");
  const scoped = await inspect(page, x, y, process.env.CARDS);
  const inner = await page.locator(".col-inner").nth(1).boundingBox();
  const column = await inspect(page, inner.x + 5, inner.y + 5, process.env.CARDS);
  const found = {
    plain,
    scoped,
    suggestedTitles: await textsIn(page, plain.collection, plain.relativeSelector),
    scopedTitles: await textsIn(page, process.env.CARDS, scoped.relativeSelector),
    column,
    columnTexts: await textsIn(page, process.env.CARDS, column.relativeSelector),
    expectedColumns: await page.$$eval(process.env.CARDS, (items) => items.map((item) => item.querySelectorAll(".col-inner")[1].textContent)),
  };
  await page.setContent(process.env.NESTED);
  const deep = page.frameLocator("#outer").frameLocator("#inner").locator(".deep");
  await deep.waitFor();
  const deepBox = await deep.boundingBox();
  const inFrames = await inspect(page, deepBox.x + deepBox.width / 2, deepBox.y + deepBox.height / 2, "");
  const resolved = await locate(page, { primary: inFrames.selector, fallbacks: [], frame: inFrames.frame });
  console.log(JSON.stringify({ ...found, inFrames, inFramesText: await resolved.first().textContent() }));
} finally {
  await browser.close();
}`;
describe("visual element selection in the worker runtime", () => {
  let out: any;
  beforeAll(() => {
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", probe],
      {
        encoding: "utf8",
        env: { ...process.env, FIXTURE: fixture, CARDS: cards, NESTED: nested },
        timeout: 60000,
      },
    );
    if (r.status !== 0) throw new Error(r.stderr || r.error?.message);
    out = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
  }, 90000);
  it("selects every product title and lists the repeating card among its parents", () => {
    expect(out.plain.count).toBe(3);
    expect(out.plain.ancestors).toContainEqual(
      expect.objectContaining({ selector: cards, count: 3, repeats: 3 }),
    );
  });
  it("suggests the repeating card as the collection when none is chosen", () => {
    expect(out.plain.collection).toBe(cards);
    expect(out.suggestedTitles).toEqual(["Product 1", "Product 2", "Product 3"]);
    expect(out.plain.rows).toEqual({ matched: 3, total: 3 });
  });
  it("tells apart elements that share classes inside an item", () => {
    expect(out.column.relativeSelector).toContain(":nth-of-type(2)");
    expect(out.columnTexts).toEqual(out.expectedColumns);
  });
  it("builds field selectors that resolve inside every chosen collection item", () => {
    expect(out.scopedTitles).toEqual(["Product 1", "Product 2", "Product 3"]);
    expect(out.scoped.rows).toEqual({ matched: 3, total: 3 });
  });
  it("selects inside nested iframes with a frame chain the engine resolves", () => {
    expect(out.inFrames.frame).toEqual(["#outer", "#inner"]);
    expect(out.inFramesText).toBe("Deep value");
  });
});
