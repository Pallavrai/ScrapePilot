import { build } from "esbuild";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  const bundle = await build({
    entryPoints: [entry],
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
  return `// ScrapePilot portable scraper
// Save as scraper.mjs (or scraper.ts and run with tsx).
// npm install playwright@1.63.0
// npx playwright install chromium
// SCRAPER_INPUT='{"searchTerm":"nerf gun"}' node scraper.mjs
// Supply SCRAPER_SECRETS as a JSON map locally; never commit secrets.
${bundle.outputFiles[0].text}
const definition = ${JSON.stringify(d, null, 2)};
const input = JSON.parse(process.env.SCRAPER_INPUT || '{}');
const secrets = JSON.parse(process.env.SCRAPER_SECRETS || '{}');
const result = await execute(definition,input,{secrets});
console.log(JSON.stringify(result,null,2));
if(result.status !== 'succeeded') process.exitCode=1;
`;
}
