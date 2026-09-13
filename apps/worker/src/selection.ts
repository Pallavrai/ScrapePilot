export async function inspect(
  page: any,
  x: number,
  y: number,
  container: string,
) {
  let target = page.mainFrame(),
    offsetX = 0,
    offsetY = 0,
    frameSelector: string | undefined;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.parentFrame() !== page.mainFrame())
      continue;
    const element = await frame.frameElement(),
      box = await element.boundingBox();
    if (
      box &&
      x >= box.x &&
      y >= box.y &&
      x <= box.x + box.width &&
      y <= box.y + box.height
    ) {
      target = frame;
      offsetX = box.x;
      offsetY = box.y;
      frameSelector = await element.evaluate((el: Element) => {
        const name = el.getAttribute("name");
        if (name) return `iframe[name=${JSON.stringify(name)}]`;
        if (el.id) return `#${CSS.escape(el.id)}`;
        return `iframe:nth-of-type(${
          Array.from(el.parentElement!.children)
            .filter((c) => c.tagName === "IFRAME")
            .indexOf(el) + 1
        })`;
      });
      break;
    }
  }
  const result = await target.evaluate(
    ({ x, y, container }: { x: number; y: number; container: string }) => {
      document.getElementById("__sp_highlight")?.remove();
      const element = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!element) return null;
      const selectorFor = (el: Element): string => {
        if (el.id && !/\d{4}/.test(el.id)) return "#" + CSS.escape(el.id);
        for (const attribute of ["data-testid", "name", "aria-label"]) {
          const value = el.getAttribute(attribute);
          if (value)
            return `${el.tagName.toLowerCase()}[${attribute}=${JSON.stringify(value)}]`;
        }
        return (
          el.tagName.toLowerCase() +
          Array.from(el.classList)
            .filter((c) => !/[0-9]{4}/.test(c))
            .slice(0, 3)
            .map((c) => "." + CSS.escape(c))
            .join("")
        );
      };
      const describe = (el: Element) => ({
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        count: document.querySelectorAll(selectorFor(el)).length,
      });
      const ancestors = [];
      let parent = element.parentElement;
      while (parent && parent !== document.body && ancestors.length < 5) {
        ancestors.push(describe(parent));
        parent = parent.parentElement;
      }
      const rect = element.getBoundingClientRect(),
        highlight = document.createElement("div");
      highlight.id = "__sp_highlight";
      Object.assign(highlight.style, {
        position: "fixed",
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: "2px solid #8d6de0",
        background: "#8d6de01a",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.documentElement.appendChild(highlight);
      return {
        ...describe(element),
        relativeSelector:
          container && element.matches(container)
            ? ":scope"
            : selectorFor(element),
        text:
          element.tagName === "INPUT" ? "" : element.innerText?.slice(0, 160),
        ancestors,
      };
    },
    { x: x - offsetX, y: y - offsetY, container },
  );
  return result ? { ...result, frame: frameSelector } : null;
}
