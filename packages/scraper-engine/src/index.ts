import {
  chromium,
  type Page,
  type Locator,
  type BrowserContext,
} from "playwright";
import {
  definitionSchema,
  interpolate,
  validateInput,
  type ScraperDefinitionV1,
  type Field,
  type LocatorSpec,
} from "@scrapepilot/contracts";
import { assertPublicUrl, redact } from "./security";
import { RE2JS } from "re2js";
export { chromium };
export class BlockedError extends Error {}
export async function locate(
  page: Page | Locator,
  spec: LocatorSpec,
  wait = true,
): Promise<Locator> {
  const scope =
    spec.frame && "frameLocator" in page ? page.frameLocator(spec.frame) : page;
  for (const selector of [spec.primary, ...spec.fallbacks]) {
    const l = scope.locator(selector);
    if (await l.count()) return l;
  }
  const pending = scope.locator(spec.primary);
  // Pages may render late, but collection items are already rendered: waiting there made runs look stuck.
  if (wait)
    try {
      await pending.first().waitFor({ state: "attached", timeout: 5000 });
      return pending;
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "TimeoutError") throw e;
    }
  throw new Error(
    `No element matches "${spec.primary}"${wait ? " after waiting 5 seconds" : ""}`,
  );
}
export function convert(
  value: string | null,
  field: Field,
  url: string,
): unknown {
  if (value === null || value === "") {
    if (field.required)
      throw new Error(`Required field missing: ${field.name}`);
    return null;
  }
  let v = field.trim ? value.trim() : value;
  if (field.regex) {
    const matcher = RE2JS.compile(field.regex.pattern).matcher(v);
    if (!matcher.find()) {
      if (field.required)
        throw new Error(`Pattern did not match: ${field.name}`);
      return null;
    }
    v = matcher.group(field.regex.group) ?? "";
  }
  switch (field.type) {
    case "number": {
      const numeric = v.replace(/[^\d.,+-]/g, "").replace(/,/g, "");
      if (!/\d/.test(numeric)) throw new Error(`Invalid number: ${field.name}`);
      const n = Number(numeric);
      if (!Number.isFinite(n)) throw new Error(`Invalid number: ${field.name}`);
      return n;
    }
    case "boolean":
      if (/^(true|yes|1)$/i.test(v)) return true;
      if (/^(false|no|0)$/i.test(v)) return false;
      throw new Error(`Invalid boolean: ${field.name}`);
    case "date": {
      const date = new Date(v);
      if (Number.isNaN(date.getTime()))
        throw new Error(`Invalid date: ${field.name}`);
      return date.toISOString();
    }
    case "url":
    case "imageUrl":
      return new URL(v, url).href;
    default:
      return v;
  }
}
async function extract(scope: Page | Locator, fields: Field[], url: string) {
  const row: Record<string, unknown> = {};
  const wait = "goto" in scope; // a detail page, not an already-rendered collection item
  for (const field of fields) {
    try {
      const el = (await locate(scope, field.locator, wait)).first();
      const value =
        field.source === "attribute"
          ? await el.getAttribute(field.attribute ?? "href")
          : field.source === "innerHTML"
            ? await el.innerHTML()
            : await el.textContent();
      row[field.name] = convert(value, field, url);
    } catch (e) {
      if (field.required)
        throw new Error(
          `Field "${field.name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      row[field.name] = null;
    }
  }
  return row;
}
type CollectionStep = Extract<
  ScraperDefinitionV1["steps"][number],
  { type: "extractCollection" }
>;
/** First rows of a collection on a live page, keeping per-item errors visible (builder Preview). */
export async function previewCollection(
  page: Page,
  step: CollectionStep,
  limit = 5,
) {
  const items = await locate(page, step.container, false);
  const total = await items.count(),
    rows: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.min(total, limit); i++)
    rows.push(
      await extract(items.nth(i), step.fields, page.url()).catch((e) => ({
        _error: `Item ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
      })),
    );
  return { total, rows };
}
export async function protectContext(
  context: BrowserContext,
  domains: string[],
  blocked: (domain: string) => Promise<boolean> = async () => false,
  proxied = false,
) {
  // Behind the egress proxy the worker has no DNS; the proxy resolves, checks and pins every address.
  const resolver = proxied ? null : undefined;
  await context.routeWebSocket("**/*", async (socket) => {
    try {
      const u = await assertPublicUrl(
        socket.url().replace(/^ws/, "http"),
        undefined,
        resolver,
      );
      if (await blocked(u.hostname)) throw new Error("Blocked domain");
      socket.connectToServer();
    } catch {
      socket.close({ code: 1008, reason: "Destination forbidden" });
    }
  });
  await context.route("**/*", async (route) => {
    try {
      const req = route.request();
      const u = await assertPublicUrl(
        req.url(),
        req.isNavigationRequest() ? domains : undefined,
        resolver,
      );
      if (await blocked(u.hostname))
        throw new Error("Domain blocked by administrator");
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  context.on("page", (p) => {
    if (context.pages().length > 2) void p.close();
    p.on("download", (d) => void d.cancel());
  });
}
export type ExecutionResult = {
  status: "succeeded" | "partial" | "blocked" | "failed" | "canceled";
  rows: Record<string, unknown>[];
  error?: { message: string; stepId?: string; url?: string };
  durationMs: number;
};
export async function execute(
  definition: ScraperDefinitionV1,
  input: Record<string, unknown>,
  options: {
    secrets?: Record<string, string>;
    signal?: AbortSignal;
    proxy?: string;
    prepareContext?: (context: BrowserContext) => Promise<void>;
    storageState?: any;
    onSession?: (state: any) => Promise<void>;
    secretDomains?: Record<string, string>;
    beforeNavigation?: (url: string) => Promise<void>;
    blocked?: (domain: string) => Promise<boolean>;
    onFailure?: (page: Page) => Promise<void>;
  } = {},
): Promise<ExecutionResult> {
  const d = definitionSchema.parse(definition),
    values = validateInput(d, input),
    started = Date.now(),
    secret = options.secrets ?? {};
  const browser = await chromium.launch({
    chromiumSandbox: true,
    headless: true,
    proxy: options.proxy ? { server: options.proxy } : undefined,
  });
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
    storageState: options.storageState,
  });
  await protectContext(
    context,
    d.allowedDomains,
    options.blocked,
    !!options.proxy,
  );
  await options.prepareContext?.(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  let stepId: string | undefined,
    rows: Record<string, unknown>[] = [],
    pages = 0;
  const seen = new Set<string>();
  let timedOut = false;
  let navigationBlock: string | undefined;
  context.on("response", (response) => {
    if (
      response.request().isNavigationRequest() &&
      [401, 403, 429].includes(response.status())
    )
      navigationBlock = `Target returned HTTP ${response.status()}`;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    void browser.close();
  }, d.limits.timeoutMs);
  const cancel = () => void browser.close();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const check = () => {
    if (navigationBlock) throw new BlockedError(navigationBlock);
    if (options.signal?.aborted) throw new Error("Canceled");
    if (Date.now() - started > d.limits.timeoutMs)
      throw new Error("Run time limit reached");
  };
  const go = async (p: Page, url: string) => {
    check();
    if (++pages > d.limits.maxPages) throw new Error("Page limit reached");
    await assertPublicUrl(
      url,
      d.allowedDomains,
      options.proxy ? null : undefined,
    );
    await options.beforeNavigation?.(url);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await p.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        if ([401, 403, 429].includes(response?.status() ?? 0))
          throw new BlockedError(`Target returned HTTP ${response!.status()}`);
        if (
          await p
            .locator(
              'iframe[src*="captcha"], [id*="captcha"], [class*="captcha"]',
            )
            .count()
        )
          throw new BlockedError("Target requires CAPTCHA verification");
        return;
      } catch (e) {
        if (e instanceof BlockedError || attempt === 2) throw e;
        await new Promise((r) =>
          setTimeout(r, 500 * 2 ** attempt + Math.random() * 200),
        );
      }
    }
  };
  try {
    const pagination = d.steps.find((s) => s.type === "paginate");
    const processSteps = async (repeat = false) => {
      for (const s of d.steps) {
        stepId = s.id;
        check();
        if (
          repeat &&
          ["navigate", "fill", "click", "select", "waitFor"].includes(s.type)
        )
          continue;
        switch (s.type) {
          case "navigate":
            await go(page, interpolate(s.url, values, secret));
            break;
          case "fill": {
            for (const m of s.value.matchAll(/\{\{secret\.(\w+)\}\}/g)) {
              if (
                options.secretDomains?.[m[1]] &&
                options.secretDomains[m[1]] !== new URL(page.url()).hostname
              )
                throw new Error("Credential domain mismatch");
            }
            await (
              await locate(page, s.locator)
            )
              .first()
              .fill(interpolate(s.value, values, secret));
            break;
          }
          case "click":
            await (await locate(page, s.locator)).first().click();
            break;
          case "select":
            await (
              await locate(page, s.locator)
            )
              .first()
              .selectOption(interpolate(s.value, values, secret));
            break;
          case "waitFor": {
            // Late content is the reason for this step, so it may wait longer than locate's 5 seconds.
            const scope = s.locator.frame ? page.frameLocator(s.locator.frame) : page;
            const target = [s.locator.primary, ...s.locator.fallbacks]
              .map((selector) => scope.locator(selector))
              .reduce((all, next) => all.or(next));
            await target
              .first()
              .waitFor({ state: "visible", timeout: 30000 })
              .catch((e) => {
                throw e instanceof Error && e.name === "TimeoutError"
                  ? new Error(`Waited 30 seconds, but nothing matched "${s.locator.primary}"`)
                  : e;
              });
            break;
          }
          case "extractCollection": {
            const collection = await locate(page, s.container);
            const count = await collection.count();
            for (let i = 0; i < count && rows.length < d.limits.maxRows; i++) {
              const row = await extract(
                collection.nth(i),
                s.fields,
                page.url(),
              ).catch((e) => {
                throw new Error(
                  `Item ${i + 1} of ${count}: ${e instanceof Error ? e.message : String(e)}`,
                );
              });
              const key = JSON.stringify(
                d.deduplicationKey ? row[d.deduplicationKey] : row,
              );
              if (seen.has(key)) continue;
              seen.add(key);
              rows.push(row);
              if (Buffer.byteLength(JSON.stringify(rows)) > 10 * 1024 * 1024)
                throw new Error("Result size limit reached");
            }
            break;
          }
          case "followEach":
            for (const row of rows) {
              if (row.__visited) continue;
              const link = row[s.linkField];
              if (typeof link !== "string")
                throw new Error("Detail link field must contain a URL");
              const detail = await context.newPage();
              try {
                await go(detail, link);
                Object.assign(
                  row,
                  await extract(detail, s.fields, detail.url()),
                  { __visited: true },
                );
              } finally {
                await detail.close();
              }
            }
            break;
          case "paginate":
            break;
        }
      }
    };
    await processSteps();
    if (pagination?.type === "paginate")
      for (
        let n = 1;
        n < pagination.maxPages && rows.length < d.limits.maxRows;
        n++
      ) {
        const before = rows.length;
        if (pagination.mode === "next") {
          const spec = pagination.next!;
          const scope = spec.frame ? page.frameLocator(spec.frame) : page;
          let next = scope.locator(spec.primary);
          for (const selector of [spec.primary, ...spec.fallbacks]) {
            const candidate = scope.locator(selector);
            if (await candidate.count()) {
              next = candidate;
              break;
            }
          }
          if (
            !(await next.first().isVisible()) ||
            !(await next.first().isEnabled())
          )
            break;
          await options.beforeNavigation?.(page.url());
          if (++pages > d.limits.maxPages) break;
          await next.first().click();
          await page.waitForLoadState("domcontentloaded");
        } else {
          const collection = d.steps.find((s) => s.type === "extractCollection");
          const items = async () =>
            collection?.type === "extractCollection"
              ? locate(page, collection.container, false).then(
                  (l) => l.count(),
                  () => 0,
                )
              : 0;
          const known = await items();
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          // More items load asynchronously: wait up to 5 seconds for them instead of a fixed pause.
          for (const end = Date.now() + 5000; Date.now() < end && (await items()) <= known; )
            await page.waitForTimeout(250);
        }
        await processSteps(true);
        if (rows.length === before) break;
      }
    for (const row of rows) delete row.__visited;
    await options.onSession?.(await context.storageState());
    return { status: "succeeded", rows, durationMs: Date.now() - started };
  } catch (e) {
    await options.onFailure?.(page).catch(() => {});
    for (const row of rows) delete row.__visited;
    return {
      status: options.signal?.aborted
        ? "canceled"
        : e instanceof BlockedError
          ? "blocked"
          : rows.length
            ? "partial"
            : "failed",
      rows,
      error: {
        message: redact(
          timedOut
            ? "Run time limit reached"
            : e instanceof Error
              ? e.message
              : "Execution failed",
          Object.values(secret),
        ),
        stepId,
        url: page.url(),
      },
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
    await browser.close();
  }
}
