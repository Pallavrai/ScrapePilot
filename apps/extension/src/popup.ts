export {};
declare const chrome: any;
declare const SCRAPEPILOT_URL: string;
const app = document.getElementById("app")!,
  account = document.getElementById("account")!;
/** Builds an element; strings become text, never markup. */
function h(
  tag: string,
  props: Record<string, unknown> = {},
  ...children: (Node | string | false | null | undefined)[]
) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...(children.filter(Boolean) as (Node | string)[]));
  return el;
}
async function ask(type: string, data: Record<string, unknown> = {}) {
  const answer = await chrome.runtime.sendMessage({ type, ...data });
  if (!answer?.ok) throw new Error(answer?.error ?? "The extension didn't answer. Close and reopen it.");
  return answer.value;
}
const openScrapePilot = (path = "/") => chrome.tabs.create({ url: `${SCRAPEPILOT_URL}${path}` });
let problem = "";
function runCard(run: any) {
  if (!run) return null;
  const running = run.status === "running";
  return h(
    "div",
    { className: "run" },
    h(
      "div",
      { className: "row" },
      h("div", {}, h("b", { textContent: run.name }), h("span", { className: "muted", textContent: `${run.rowCount ?? 0} rows saved` })),
      h("span", { className: `status ${run.status}`, textContent: running ? "running" : run.status }),
    ),
    run.message && h("p", { className: ["failed", "blocked"].includes(run.status) ? "error" : "muted", textContent: run.message }),
    running
      ? h("button", { textContent: "Stop run", onclick: () => ask("stop").catch(fail) })
      : h("button", { className: "link", textContent: "Open Run history", onclick: () => openScrapePilot() }),
  );
}
function fail(e: unknown) {
  problem = e instanceof Error ? e.message : String(e);
  void render();
}
/** Asks for the scraper's sites first: Chrome only shows that prompt right after a click. */
async function run(scraper: any, input: Record<string, unknown>) {
  problem = "";
  const domains: string[] = scraper.latestVersion.allowedDomains;
  const granted = await chrome.permissions.request({
    origins: domains.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]),
  });
  if (!granted) return fail(new Error(`ScrapePilot needs your permission to open ${domains.join(", ")}. Choose Run again and allow it.`));
  await ask("start", { scraperId: scraper.id, input }).catch(fail);
}
function inputForm(scraper: any, fields: [string, any][]) {
  const form = h("form", {
    onsubmit: (event: Event) => {
      event.preventDefault();
      const input: Record<string, unknown> = {};
      for (const [name, spec] of fields) {
        const el = form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        if (spec.type === "boolean") input[name] = el.checked;
        else if (el.value !== "") input[name] = spec.type === "number" ? Number(el.value) : el.value;
      }
      void run(scraper, input);
    },
  });
  for (const [name, spec] of fields)
    form.append(
      spec.type === "boolean"
        ? h("label", { className: "check" }, h("input", { type: "checkbox", name, checked: spec.default === true }), name)
        : h(
            "label",
            {},
            `${name}${spec.required ? "" : " (optional)"}`,
            h("input", {
              name,
              type: spec.type === "number" ? "number" : spec.type === "url" ? "url" : "text",
              required: spec.required,
              value: spec.default ?? "",
              step: "any",
            }),
          ),
    );
  form.append(h("button", { className: "primary", type: "submit", textContent: "Start run" }));
  return form;
}
async function render() {
  const { token, email } = await chrome.storage.local.get(["token", "email"]),
    { run: latest } = await chrome.storage.session.get("run");
  account.textContent = email ?? "";
  if (!token) {
    app.replaceChildren(
      h(
        "section",
        {},
        h("h2", { textContent: "Run scrapers in this browser" }),
        h("p", {
          className: "muted",
          textContent:
            "Your saved scrapers run here, with the logins you already have. Results save to your ScrapePilot account, ready in Run history and the API.",
        }),
        problem && h("p", { className: "error", textContent: problem }),
        h("button", { className: "primary", textContent: "Connect ScrapePilot", onclick: () => openScrapePilot("/extension/connect") }),
      ),
    );
    return;
  }
  const busy = latest?.status === "running";
  let scrapers: any[] = [];
  try {
    scrapers = await ask("scrapers");
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const list = h("ul");
  for (const scraper of scrapers) {
    const version = scraper.latestVersion,
      fields = Object.entries(version?.inputs ?? {}).filter(([, spec]: [string, any]) => spec.type !== "secretRef") as [string, any][];
    const item = h(
      "li",
      {},
      h(
        "div",
        { className: "row" },
        h(
          "div",
          {},
          h("b", { textContent: scraper.name }),
          h("span", {
            className: "muted",
            textContent: version
              ? `Version ${version.number} · ${version.allowedDomains.join(", ")}`
              : "Save a version in the editor to run it",
          }),
        ),
        h("button", {
          className: "primary",
          textContent: "Run",
          disabled: !version || busy,
          onclick: () => {
            if (!fields.length) return void run(scraper, {});
            const open = item.querySelector("form");
            if (open) open.remove();
            else item.append(inputForm(scraper, fields));
          },
        }),
      ),
    );
    list.append(item);
  }
  app.replaceChildren(
    ...[
      runCard(latest),
      problem && h("p", { className: "error", role: "alert", textContent: problem }),
      h(
        "section",
        {},
        h("h2", { textContent: "Your scrapers" }),
        scrapers.length
          ? list
          : h("p", { className: "muted" }, "No scrapers yet. ", h("button", { className: "link", textContent: "Build one in ScrapePilot", onclick: () => openScrapePilot() })),
      ),
      h(
        "footer",
        {},
        "Runs use your own accounts: follow each site's rules and the ",
        h("a", { href: `${SCRAPEPILOT_URL}/acceptable-use`, target: "_blank", textContent: "Acceptable Use Policy" }),
        ". ",
        h("button", {
          className: "link",
          textContent: "Disconnect",
          onclick: () => ask("disconnect").catch(fail),
        }),
      ),
    ].filter(Boolean) as Node[],
  );
}
chrome.storage.onChanged.addListener((changes: any, area: string) => {
  if (area === "local" && (changes.token || changes.email)) return void render();
  if (area === "session" && changes.run) {
    const [before, after] = [changes.run.oldValue?.status, changes.run.newValue?.status];
    // Row counts only update the run card; a start or finish also changes which buttons work.
    if (before === after) app.querySelector(".run")?.replaceWith(runCard(changes.run.newValue)!);
    else void render();
  }
});
void render();
