// Runs inside the target page, so it is kept as source text: tsx (esbuild keepNames)
// rewrites named functions in TypeScript into __name(...) calls that do not exist there.
const picker = String.raw`({ x, y, container, highlightOnly }) => {
  document.getElementById("__sp_highlight")?.remove();
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  const rect = element.getBoundingClientRect(),
    highlight = document.createElement("div");
  highlight.id = "__sp_highlight";
  Object.assign(highlight.style, {
    position: "fixed",
    top: rect.top + "px",
    left: rect.left + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    border: "2px solid #8d6de0",
    background: "#8d6de01a",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(highlight);
  if (highlightOnly) return null;
  const quote = (value) => '"' + value.replace(/["\\]/g, "\\$&") + '"';
  const count = (selector) => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };
  const repeatsOf = (el, selector) => {
    try {
      return el.parentElement ? Array.from(el.parentElement.children).filter((s) => s.matches(selector)).length : 1;
    } catch {
      return 1;
    }
  };
  // Tag plus a stable attribute or classes: no ids or text labels, so sibling items share it.
  const generic = (el) => {
    const tag = el.tagName.toLowerCase();
    for (const name of ["data-testid", "data-test", "data-qa", "data-cy", "data-component-type", "itemprop", "name"]) {
      const value = el.getAttribute(name);
      if (value && value.length <= 60) return tag + "[" + name + "=" + quote(value) + "]";
    }
    return tag + Array.from(el.classList)
      .filter((c) => !/\d{4}/.test(c))
      .slice(0, 3)
      .map((c) => "." + CSS.escape(c))
      .join("");
  };
  const selectorFor = (el) => {
    if (el.id && !/\d{4}/.test(el.id)) return "#" + CSS.escape(el.id);
    let selector = generic(el),
      bare = selector === el.tagName.toLowerCase();
    const label = el.getAttribute("aria-label");
    if (bare && label && label.length <= 40)
      return selector + "[aria-label=" + quote(label) + "]";
    // A bare tag such as "span" matches the whole page; anchor it to its nearest parents.
    for (let parent = el.parentElement, depth = 0; bare && parent && parent !== document.body && depth < 3; parent = parent.parentElement, depth++) {
      const part = generic(parent);
      selector = part + " > " + selector;
      bare = part === parent.tagName.toLowerCase();
    }
    return selector;
  };
  // Without a chosen collection, suggest the ancestor repeated most among its siblings (e.g. product cards).
  let collection = container;
  if (!collection)
    for (let parent = element.parentElement, best = 1; parent && parent !== document.body; parent = parent.parentElement) {
      const selector = selectorFor(parent),
        repeats = selector.startsWith("#") ? 1 : repeatsOf(parent, selector);
      if (repeats > best) {
        best = repeats;
        collection = selector;
      }
    }
  let item = null,
    items = [];
  try {
    item = collection ? element.closest(collection) : null;
    items = collection ? Array.from(document.querySelectorAll(collection)) : [];
  } catch {}
  // Shortest generic path, walking up towards the collection item, that finds el first.
  const relativeTo = (el) => {
    if (!item || !item.contains(el)) return undefined;
    if (el === item) return ":scope";
    let selector = generic(el);
    for (let parent = el.parentElement; item.querySelector(selector) !== el && parent && parent !== item; parent = parent.parentElement)
      selector = generic(parent) + " " + selector;
    if (item.querySelector(selector) === el) return selector;
    // Classes are shared inside the item (e.g. an image and a text column); fall back to positions.
    const parts = [];
    for (let node = el; node !== item; node = node.parentElement) {
      const same = Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName);
      parts.unshift(generic(node) + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : ""));
    }
    return ":scope > " + parts.join(" > ");
  };
  const describe = (el) => {
    const selector = selectorFor(el),
      relativeSelector = relativeTo(el);
    return {
      selector,
      tag: el.tagName.toLowerCase(),
      count: count(selector),
      repeats: repeatsOf(el, selector),
      relativeSelector,
      rows: relativeSelector
        ? { matched: items.filter((i) => relativeSelector === ":scope" || i.querySelector(relativeSelector)).length, total: items.length }
        : undefined,
    };
  };
  // Repeating product cards often sit 15+ levels above the clicked text.
  const ancestors = [];
  for (let parent = element.parentElement, depth = 0; parent && parent !== document.body && depth < 30 && ancestors.length < 20; parent = parent.parentElement, depth++) {
    const info = describe(parent);
    if (!ancestors.some((a) => a.selector === info.selector)) ancestors.push(info);
  }
  return {
    ...describe(element),
    collection: item ? collection : undefined,
    text: element.tagName === "INPUT" ? "" : (element.innerText || "").slice(0, 160),
    ancestors,
  };
}`;
export async function inspect(
  page: any,
  x: number,
  y: number,
  container: string,
  highlightOnly = false,
) {
  // Descend into the iframe under the point, level by level, recording one selector per frame.
  // Bounding boxes are relative to the page viewport at every depth.
  let target = page.mainFrame(),
    offsetX = 0,
    offsetY = 0;
  const frames: string[] = [];
  for (let depth = 0; depth < 5; depth++) {
    let inner: any;
    for (const frame of target.childFrames()) {
      const element = await frame.frameElement(),
        box = await element.boundingBox();
      if (
        box &&
        x >= box.x &&
        y >= box.y &&
        x <= box.x + box.width &&
        y <= box.y + box.height
      ) {
        inner = frame;
        offsetX = box.x;
        offsetY = box.y;
        frames.push(
          await element.evaluate((el: Element) => {
            const name = el.getAttribute("name");
            if (name) return `iframe[name=${JSON.stringify(name)}]`;
            if (el.id) return `#${CSS.escape(el.id)}`;
            return `iframe:nth-of-type(${
              Array.from(el.parentElement!.children)
                .filter((c) => c.tagName === "IFRAME")
                .indexOf(el) + 1
            })`;
          }),
        );
        break;
      }
    }
    if (!inner) break;
    target = inner;
  }
  const args = JSON.stringify({
    x: x - offsetX,
    y: y - offsetY,
    container,
    highlightOnly,
  });
  const result = await target.evaluate(`(${picker})(${args})`);
  return result
    ? { ...result, frame: frames.length > 1 ? frames : frames[0] }
    : null;
}
