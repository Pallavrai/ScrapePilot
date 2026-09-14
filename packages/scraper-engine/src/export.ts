import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  definitionSchema,
  type ScraperDefinitionV1,
} from "@scrapepilot/contracts";
export async function exportScript(definition: ScraperDefinitionV1) {
  const d = definitionSchema.parse(definition);
  const root = process.env.SCRAPEPILOT_ROOT ?? process.cwd();
  const entry = [
    resolve(root, "packages/scraper-engine/src/index.ts"),
    resolve(root, "../../packages/scraper-engine/src/index.ts"),
  ].find(existsSync);
  if (!entry)
    throw new Error("Scraper engine sources are unavailable for export");
  // Bundled together with the engine, so esbuild renames anything that clashes with the engine's own names.
  const runner = `import { chromium, execute } from ${JSON.stringify(entry)};
const definition = ${JSON.stringify(d, null, 2)};
const input = JSON.parse(process.env.SCRAPER_INPUT || '{}');
const secrets = JSON.parse(process.env.SCRAPER_SECRETS || '{}');
const profile = {
  dir: process.env.SCRAPER_PROFILE || 'scrapepilot-profile',
  headless: process.argv.includes('--headless'),
  channel: process.env.SCRAPER_CHANNEL || undefined,
};
if (process.argv.includes('--login')) {
  const context = await chromium.launchPersistentContext(profile.dir, { chromiumSandbox: true, headless: false, channel: profile.channel, viewport: null });
  const start = definition.steps.find((step) => step.type === 'navigate')?.url;
  const tab = context.pages()[0] ?? (await context.newPage());
  if (start && !start.includes('{{')) await tab.goto(start);
  console.log('Sign in to the site in the browser window, then press Enter here to keep the login.');
  await new Promise((done) => process.stdin.once('data', done));
  await context.close();
  process.exit(0);
}
// At least one second between page loads, the same pace as ScrapePilot's servers.
let lastLoad = 0;
const beforeNavigation = async () => {
  const wait = lastLoad + 1000 - Date.now();
  if (wait > 0) await new Promise((done) => setTimeout(done, wait));
  lastLoad = Date.now();
};
const result = await execute(definition, input, { secrets, profile, beforeNavigation });
const file = 'results-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
await (await import('node:fs/promises')).writeFile(file, JSON.stringify(result.rows, null, 2));
console.log(result.status + ': ' + result.rows.length + ' rows saved to ' + file);
if (result.error) console.log(result.error.message);
if (result.status !== 'succeeded') process.exitCode = 1;
`;
  const bundle = await build({
    stdin: {
      contents: runner,
      resolveDir: dirname(entry),
      sourcefile: "scraper.mjs",
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["playwright"],
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    legalComments: "none",
  });
  return `// ScrapePilot scraper that runs on your own computer, with your internet connection and browser profile.
// Setup (Node 24 or later), in the folder with this file:
//   npm install playwright@1.63.0
//   npx playwright install chromium
// Sign in once if the site needs it: node scraper.mjs --login
//   A browser window opens. Sign in yourself, then press Enter here. The login is kept in the
//   scrapepilot-profile folder (set SCRAPER_PROFILE to change it). Keep it private; delete it to sign out.
// Run: SCRAPER_INPUT='{"searchTerm":"nerf gun"}' node scraper.mjs
//   Add --headless to hide the window. SCRAPER_CHANNEL=chrome uses your installed Google Chrome
//   (use it for --login too). Results are saved to results-<time>.json.
// Supply SCRAPER_SECRETS as a JSON map for {{secret.name}} values; never commit secrets.
${bundle.outputFiles[0].text}`;
}
