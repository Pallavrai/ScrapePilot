import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
/** Builds the unpacked Chrome extension for one ScrapePilot server. */
export async function buildExtension({
  server = "http://localhost:3000",
  out = here("./dist/"),
  // Tests pre-grant their fixture sites: automation cannot answer Chrome's permission prompt.
  grantedSites = [] as string[],
} = {}) {
  const origin = new URL(server).origin,
    { protocol, hostname } = new URL(origin);
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(
      ["background", "page", "popup", "connect"].map((name) => [
        name,
        here(`./src/${name}.ts`),
      ]),
    ),
    bundle: true,
    format: "iife",
    target: "chrome120",
    outdir: out,
    logLevel: "warning",
    define: { SCRAPEPILOT_URL: JSON.stringify(origin) },
  });
  await copyFile(here("./src/popup.html"), `${out}/popup.html`);
  // Match patterns without a port match every port, which covers local development servers.
  const site = `${protocol}//${hostname}`;
  const manifest = {
    manifest_version: 3,
    name: "ScrapePilot",
    version: "0.1.0",
    description:
      "Run your ScrapePilot scrapers in your own browser, with the logins you already have, and save the results to your account.",
    minimum_chrome_version: "120",
    action: { default_title: "ScrapePilot", default_popup: "popup.html" },
    background: { service_worker: "background.js" },
    permissions: ["scripting", "storage"],
    host_permissions: [`${site}/*`, ...grantedSites],
    // Asked for per site, when a scraper for that site first runs.
    optional_host_permissions: ["https://*/*", "http://*/*"],
    content_scripts: [
      {
        matches: [`${site}/extension/connect*`],
        js: ["connect.js"],
        run_at: "document_start",
      },
    ],
  };
  await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = process.env.SCRAPEPILOT_URL ?? "http://localhost:3000";
  console.log(`Built ${await buildExtension({ server })} for ${server}`);
}
