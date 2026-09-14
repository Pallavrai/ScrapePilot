// Runs inside the scraper's tab, in the extension's isolated world. It follows the cloud
// engine's step rules (packages/scraper-engine/src/index.ts) against the live page.
import { convert } from "@scrapepilot/scraper-engine/convert";
import type {
  Field,
  LocatorSpec,
  ScraperDefinitionV1,
} from "@scrapepilot/contracts";
type Collection = Extract<
  ScraperDefinitionV1["steps"][number],
  { type: "extractCollection" }
>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The page, or a same-site iframe reached through the locator's frame chain. */
function scope(spec: LocatorSpec, root: ParentNode): ParentNode {
  const chain =
    typeof spec.frame === "string" ? [spec.frame] : (spec.frame ?? []);
  return chain.reduce<ParentNode>((node, selector) => {
    const frame = node.querySelector(selector) as HTMLIFrameElement | null;
    if (!frame?.contentDocument)
      throw new Error(
        `Can't read the frame "${selector}". Runs in your browser read frames from the same site only.`,
      );
    return frame.contentDocument;
  }, root);
}
/** Elements of the first selector that matches, trying the primary selector and then its fallbacks. */
function find(spec: LocatorSpec, root: ParentNode = document) {
  const within = scope(spec, root);
  for (const selector of [spec.primary, ...spec.fallbacks]) {
    try {
      // ":scope" is the collection item itself, which querySelectorAll never returns.
      const found =
        selector.trim() === ":scope" && "matches" in within
          ? [within as Element]
          : Array.from(within.querySelectorAll(selector));
      if (found.length) return found;
    } catch {
      if (selector === spec.primary)
        throw new Error(
          `"${selector}" is not a CSS selector. Runs in your browser need CSS selectors.`,
        );
    }
  }
  return [];
}
async function locate(
  spec: LocatorSpec,
  wait: boolean,
  root: ParentNode = document,
) {
  // Pages may render late, but collection items are already rendered, as in the cloud engine.
  const end = Date.now() + (wait ? 5000 : 0);
  for (;;) {
    let found: Element[] = [],
      problem: unknown;
    try {
      found = find(spec, root);
    } catch (e) {
      problem = e;
    }
    if (found.length) return found;
    if (Date.now() >= end) {
      if (problem) throw problem;
      throw new Error(
        `No element matches "${spec.primary}"${wait ? " after waiting 5 seconds" : ""}`,
      );
    }
    await sleep(100);
  }
}
const visible = (el: Element) =>
  el.getClientRects().length > 0 &&
  el.ownerDocument.defaultView?.getComputedStyle(el).visibility !== "hidden";
function click(el: Element) {
  el.scrollIntoView({ block: "center" });
  if (el instanceof el.ownerDocument.defaultView!.HTMLElement) el.click();
  else
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
}
function changed(el: Element) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
async function readRow(root: ParentNode, fields: Field[], wait: boolean) {
  const row: Record<string, unknown> = {};
  for (const field of fields) {
    try {
      const el = (await locate(field.locator, wait, root))[0];
      const value =
        field.source === "attribute"
          ? el.getAttribute(field.attribute ?? "href")
          : field.source === "innerHTML"
            ? el.innerHTML
            : el.textContent;
      row[field.name] = convert(value, field, location.href);
    } catch (e) {
      if (field.required) throw new Error(`Field "${field.name}": ${message(e)}`);
      row[field.name] = null;
    }
  }
  return row;
}
const actions = {
  async fill(spec: LocatorSpec, value: string) {
    const el = (await locate(spec, true))[0] as HTMLElement;
    el.scrollIntoView({ block: "center" });
    el.focus();
    // The isolated world sees the native value setter, so React and Vue notice the input event.
    if (el.isContentEditable) el.textContent = value;
    else if ("value" in el) (el as HTMLInputElement).value = value;
    else throw new Error(`"${spec.primary}" is not a text box`);
    changed(el);
  },
  async click(spec: LocatorSpec) {
    click((await locate(spec, true))[0]);
  },
  async select(spec: LocatorSpec, value: string) {
    const el = (await locate(spec, true))[0] as HTMLSelectElement;
    const options = Array.from(el.options ?? []);
    const option =
      options.find((o) => o.value === value) ??
      options.find((o) => o.label === value);
    if (!option) throw new Error(`"${spec.primary}" has no option "${value}"`);
    el.value = option.value;
    changed(el);
  },
  async waitFor(spec: LocatorSpec, until: number) {
    for (;;) {
      try {
        const within = scope(spec, document);
        const shown = [spec.primary, ...spec.fallbacks].some((selector) => {
          try {
            return Array.from(within.querySelectorAll(selector)).some(visible);
          } catch {
            return false;
          }
        });
        if (shown) return;
      } catch {}
      if (Date.now() > until)
        throw new Error(
          `Waited 30 seconds, but nothing matched "${spec.primary}"`,
        );
      await sleep(200);
    }
  },
  async collect(step: Collection, maxRows: number) {
    const items = await locate(step.container, true),
      rows: Record<string, unknown>[] = [];
    for (let i = 0; i < items.length && rows.length < maxRows; i++)
      rows.push(
        await readRow(items[i], step.fields, false).catch((e) => {
          throw new Error(`Item ${i + 1} of ${items.length}: ${message(e)}`);
        }),
      );
    return rows;
  },
  /** The listed items' text, to notice when a next page replaces them in place. */
  async listed(container: LocatorSpec) {
    return locate(container, false).then(
      (items) => items.map((el) => (el as HTMLElement).innerText).join("\n"),
      () => "",
    );
  },
  async nextReady(spec: LocatorSpec) {
    try {
      const next = find(spec)[0];
      return (
        !!next &&
        visible(next) &&
        !(next as HTMLButtonElement).disabled &&
        next.getAttribute("aria-disabled") !== "true"
      );
    } catch {
      return false;
    }
  },
  async scroll(container: LocatorSpec | null) {
    const count = async () =>
      container ? (await locate(container, false).catch(() => [])).length : 0;
    const known = await count();
    window.scrollTo(0, document.body.scrollHeight);
    // More items load asynchronously: wait up to 5 seconds for them.
    for (const end = Date.now() + 5000; Date.now() < end && (await count()) <= known; )
      await sleep(250);
  },
};
// Never throws, so the service worker can tell a step's error from an interrupted page.
(globalThis as any).__scrapepilot = async (
  name: keyof typeof actions,
  args: unknown[],
) => {
  try {
    return { ok: true, value: await (actions[name] as Function)(...args) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
};
