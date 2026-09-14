// Owns each run: asks ScrapePilot to start it, drives the tab one step at a time through
// page.ts, uploads rows as they are collected and reports the outcome. Definitions, limits,
// duplicate handling and results all live on the server.
import { interpolate, type ScraperDefinitionV1 } from "@scrapepilot/contracts";
declare const chrome: any;
declare const SCRAPEPILOT_URL: string;
type Status = "succeeded" | "failed" | "blocked" | "canceled";
class Blocked extends Error {}
class Stopped extends Error {}
class StepError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
async function api(path: string, method = "GET", body?: unknown) {
  const { token } = await chrome.storage.local.get("token");
  if (!token) throw new Error("Connect your ScrapePilot account first.");
  const response = await fetch(`${SCRAPEPILOT_URL}/api/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new Error("Can't reach ScrapePilot. Check your internet connection.");
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await chrome.storage.local.remove(["token", "email"]);
    throw new Error("This browser was disconnected from ScrapePilot. Connect it again.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error ?? `ScrapePilot answered with HTTP ${response.status}`),
      { status: response.status },
    );
  return data;
}
/** What the popup shows about the latest run. */
let shown: Record<string, unknown> = {};
const show = (update: Record<string, unknown>) =>
  chrome.storage.session.set({ run: (shown = { ...shown, ...update }) });
let active: { stop: boolean } | null = null;
const originsFor = (domains: string[]) =>
  domains.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]);
async function start(scraperId: string, input: Record<string, unknown>) {
  if (active) throw new Error("A run is already in progress. Stop it before starting another.");
  active = { stop: false };
  try {
    const started = await api(`scrapers/${scraperId}/browser-runs`, "POST", { input });
    const d: ScraperDefinitionV1 = started.definition;
    if (!(await chrome.permissions.contains({ origins: originsFor(d.allowedDomains) }))) {
      const problem = `Allow ScrapePilot on ${d.allowedDomains.join(", ")} to run this scraper.`;
      await api(`runs/${started.runId}/finish`, "POST", {
        status: "failed",
        error: { message: problem },
      }).catch(() => {});
      throw new Error(problem);
    }
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    shown = {};
    await show({
      id: started.runId,
      name: d.name,
      status: "running",
      rowCount: 0,
      message: "Opening the first page",
    });
    void execute(started.runId, d, started.input, tab.id, active).finally(() => {
      active = null;
    });
    return { runId: started.runId };
  } catch (e) {
    active = null;
    throw e;
  }
}
async function execute(
  runId: string,
  d: ScraperDefinitionV1,
  input: Record<string, unknown>,
  tabId: number,
  control: { stop: boolean },
) {
  const started = Date.now(),
    // Extension API calls keep Chrome from stopping the service worker during long waits.
    keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000),
    allowed = (host: string) => d.allowedDomains.some((domain) => host === domain.toLowerCase());
  let pages = 0,
    lastLoad = 0,
    lastCheck = Date.now(),
    rowCount = 0,
    full = false,
    stepId: string | undefined,
    mark = "";
  // Stops on Stop, on the time limit, and when the run was canceled or ended on ScrapePilot.
  const check = async () => {
    if (control.stop) throw new Stopped("Canceled");
    if (Date.now() - started > d.limits.timeoutMs) throw new Error("Run time limit reached");
    if (Date.now() - lastCheck < 5000) return;
    lastCheck = Date.now();
    const current = await api(`runs/${runId}`);
    if (current.status !== "running") throw new Stopped("Canceled");
  };
  // One page load per second at most, like cloud runs.
  const pace = async () => {
    const wait = lastLoad + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastLoad = Date.now();
  };
  const script = (func: (...args: any[]) => unknown, args: unknown[] = []) =>
    chrome.scripting
      .executeScript({ target: { tabId }, func, args })
      .then((results: any[]) => results[0]?.result);
  // A new document has none of the marks set in the extension's world on the previous one.
  const probe = (current: string) =>
    script(
      (m: string) => ({
        fresh: (globalThis as any).__scrapepilotMark !== m,
        loading: document.readyState === "loading",
        status: (performance.getEntriesByType("navigation")[0] as any)?.responseStatus ?? 0,
        captcha: !!document.querySelector('iframe[src*="captcha"], [id*="captcha"], [class*="captcha"]'),
      }),
      [current],
    ).catch(() => null);
  /** Waits for the page to load; sameDocument accepts a click that did not navigate after all. */
  const ready = async (sameDocument: boolean) => {
    let away = 0,
      unchanged = 0;
    for (const end = Date.now() + 30000; ; await sleep(100)) {
      if (control.stop) throw new Stopped("Canceled");
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error("The tab running this scraper was closed.");
      const host = tab.url ? new URL(tab.url).hostname.toLowerCase() : "";
      const doc = allowed(host) ? await probe(mark) : null;
      if (doc && !doc.loading && (doc.fresh || (sameDocument && tab.status === "complete" && (unchanged ||= Date.now()) < Date.now() - 1000))) {
        if ([401, 403, 429].includes(doc.status)) throw new Blocked(`Target returned HTTP ${doc.status}`);
        if (doc.captcha) throw new Blocked("Target requires CAPTCHA verification");
        return;
      }
      // Pages outside the allowed domains stop the run, as their navigation is refused in cloud runs.
      if (!allowed(host) && tab.status === "complete" && (away ||= Date.now()) < Date.now() - 1500)
        throw new Error(`The page left this scraper's sites${host ? ` for ${host}` : ""}. Add the site to its allowed domains if it belongs there.`);
      if (Date.now() > end) throw new Error("The page didn't finish loading within 30 seconds");
    }
  };
  /** Runs one page.ts action, and again on the new document if a page load interrupted it. */
  const inPage = async (name: string, ...args: unknown[]): Promise<any> => {
    for (let attempt = 1; ; attempt++) {
      mark = crypto.randomUUID();
      try {
        const loaded = await script(
          (m: string) => {
            (globalThis as any).__scrapepilotMark = m;
            return typeof (globalThis as any).__scrapepilot === "function";
          },
          [mark],
        );
        if (!loaded) await chrome.scripting.executeScript({ target: { tabId }, files: ["page.js"] });
        let settled = false;
        const outcome = await Promise.race([
          script((n: string, a: unknown[]) => (globalThis as any).__scrapepilot(n, a), [name, args]).finally(() => {
            settled = true;
          }),
          // A page load during the action destroys its document, and its answer never comes.
          (async () => {
            for (let unreachable = 0; !settled; ) {
              await sleep(500);
              const doc = await probe(mark);
              unreachable = doc ? 0 : unreachable || Date.now();
              if (!settled && (doc?.fresh || (unreachable && Date.now() - unreachable > 5000)))
                throw new Error("The page loaded again");
            }
          })(),
        ]);
        if (!outcome) throw new Error("The page didn't answer");
        if (!outcome.ok) throw new StepError(outcome.error);
        return outcome.value;
      } catch (e) {
        if (e instanceof StepError || e instanceof Stopped || e instanceof Blocked) throw e;
        if (attempt === 3) throw new Error(`The page kept reloading: ${message(e)}`);
        await ready(false);
      }
    }
  };
  const afterClick = async () => {
    await sleep(300);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === "loading") await ready(true);
  };
  const go = async (url: string) => {
    await check();
    if (++pages > d.limits.maxPages) throw new Error("Page limit reached");
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol) || !allowed(target.hostname.toLowerCase()))
      throw new Error("Domain is not declared in this scraper");
    await pace();
    mark = crypto.randomUUID();
    await script((m: string) => {
      (globalThis as any).__scrapepilotMark = m;
    }, [mark]).catch(() => {});
    await chrome.tabs.update(tabId, { url: target.href });
    await ready(false);
  };
  // Batches stay under the server's 1 MB request limit.
  const upload = async (rows: Record<string, unknown>[]) => {
    const encoder = new TextEncoder();
    for (let i = 0; i < rows.length; ) {
      const batch: Record<string, unknown>[] = [];
      for (let size = 0; i < rows.length && batch.length < 500; i++) {
        const bytes = encoder.encode(JSON.stringify(rows[i])).length;
        if (batch.length && size + bytes > 800000) break;
        batch.push(rows[i]);
        size += bytes;
      }
      const saved = await api(`runs/${runId}/rows`, "POST", { rows: batch });
      rowCount = saved.rowCount;
      await show({ rowCount });
      if (saved.limit === "size") throw new Error("Result size limit reached");
      if (saved.limit === "rows") return void (full = true);
    }
  };
  const processSteps = async (repeat: boolean) => {
    for (const s of d.steps) {
      if (repeat && s.type !== "extractCollection") continue;
      stepId = s.id;
      await check();
      switch (s.type) {
        case "navigate":
          await go(interpolate(s.url, input));
          break;
        case "fill":
          await inPage("fill", s.locator, interpolate(s.value, input));
          break;
        case "click":
          await inPage("click", s.locator);
          await afterClick();
          break;
        case "select":
          await inPage("select", s.locator, interpolate(s.value, input));
          break;
        case "waitFor":
          await inPage("waitFor", s.locator, Date.now() + 30000);
          break;
        case "extractCollection":
          if (full) break;
          await show({ message: `Collecting items from page ${Math.max(1, pages)}` });
          await upload(await inPage("collect", s, d.limits.maxRows));
          break;
      }
    }
  };
  let outcome: Status = "succeeded",
    error: { message: string; stepId?: string; url?: string } | undefined;
  try {
    await processSteps(false);
    const pagination = d.steps.find((s) => s.type === "paginate"),
      collection = d.steps.find((s) => s.type === "extractCollection"),
      container = collection?.type === "extractCollection" ? collection.container : null;
    if (pagination?.type === "paginate")
      for (let n = 1; n < pagination.maxPages && !full; n++) {
        stepId = pagination.id;
        await check();
        const before = rowCount;
        if (pagination.mode === "next") {
          if (!(await inPage("nextReady", pagination.next))) break;
          await pace();
          if (++pages > d.limits.maxPages) break;
          const listed = container ? await inPage("listed", container) : null;
          await inPage("click", pagination.next);
          await afterClick();
          // Single-page apps replace the results without loading a page: wait up to 10 seconds for them.
          if (listed !== null)
            for (const end = Date.now() + 10000; Date.now() < end && (await inPage("listed", container)) === listed; )
              await sleep(250);
        } else await inPage("scroll", container);
        await processSteps(true);
        if (rowCount === before) break;
      }
  } catch (e) {
    const stopped =
      e instanceof Stopped ||
      ((e as { status?: number }).status === 409 && /canceled|already finished/.test(message(e)));
    outcome = stopped ? "canceled" : e instanceof Blocked ? "blocked" : "failed";
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    error = { message: stopped ? "Canceled" : message(e), stepId, url: tab?.url };
  } finally {
    clearInterval(keepAlive);
  }
  let status: string = outcome;
  try {
    status = (await api(`runs/${runId}/finish`, "POST", { status: outcome, error })).status;
  } catch (e) {
    // Already ended on ScrapePilot, for example canceled from Run history.
    status = (await api(`runs/${runId}`).catch(() => null))?.status ?? outcome;
    if ((e as { status?: number }).status !== 409) error = { message: `The result couldn't be saved: ${message(e)}` };
  }
  await show({
    status,
    rowCount,
    message:
      status === "succeeded"
        ? `Saved ${rowCount} ${rowCount === 1 ? "row" : "rows"} to your ScrapePilot account`
        : (error?.message ?? ""),
  });
}
// A service worker that restarts has lost its run; end it so the account isn't left waiting.
void chrome.storage.session.get("run").then(async ({ run }: { run?: any }) => {
  if (run?.status !== "running" || active) return;
  shown = run;
  const problem = "The extension stopped during this run. Start it again.";
  await api(`runs/${run.id}/finish`, "POST", { status: "failed", error: { message: problem } }).catch(() => {});
  await show({ status: "failed", message: problem });
});
async function handle(request: any, sender: any) {
  if (request.type === "connect") {
    if (sender.origin !== SCRAPEPILOT_URL || !sender.url?.startsWith(`${SCRAPEPILOT_URL}/extension/connect`))
      throw new Error("Connect from your ScrapePilot account's connect page.");
    await chrome.storage.local.set({ token: request.token });
    try {
      const me = await api("me");
      await chrome.storage.local.set({ email: me.email });
      return { email: me.email };
    } catch (e) {
      await chrome.storage.local.remove(["token", "email"]);
      throw e;
    }
  }
  // Everything else comes from the extension's own popup.
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("Not allowed");
  switch (request.type) {
    case "scrapers":
      return api("scrapers");
    case "start":
      return start(String(request.scraperId), request.input ?? {});
    case "stop":
      if (active) {
        active.stop = true;
        if (shown.id) await api(`runs/${shown.id}/cancel`, "POST", {}).catch(() => {});
      }
      return null;
    case "disconnect": {
      // Revoke this browser's key, found by its prefix, then forget it.
      const { token } = await chrome.storage.local.get("token");
      const keys = token ? await api("keys").catch(() => []) : [];
      for (const key of keys)
        if (key.prefix === token.slice(0, 10) && key.name.startsWith("Chrome extension"))
          await api(`keys/${key.id}`, "DELETE").catch(() => {});
      await chrome.storage.local.remove(["token", "email"]);
      return null;
    }
  }
  throw new Error("Unknown request");
}
chrome.runtime.onMessage.addListener((request: any, sender: any, reply: (answer: unknown) => void) => {
  handle(request, sender).then(
    (value) => reply({ ok: true, value }),
    (e) => reply({ ok: false, error: message(e) }),
  );
  return true;
});
