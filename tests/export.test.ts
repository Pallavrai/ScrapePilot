import { it, expect } from "vitest";
import { exportScript } from "../packages/scraper-engine/src/export";
import { emptyDefinition } from "../packages/contracts/src/index";
it("exports a portable program without workspace imports or stored credentials", async () => {
  const output = await exportScript(emptyDefinition());
  expect(output).toContain('from "playwright"');
  expect(output).not.toContain("from '@scrapepilot/");
  expect(output).not.toContain("ENCRYPTION_KEY");
  expect(output).toContain("SCRAPER_INPUT");
  expect(output).toContain("SCRAPER_SECRETS");
});
