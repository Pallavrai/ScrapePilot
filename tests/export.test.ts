import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
it("runs on the user's computer with a profile they sign in to, paced, saving results to a file", async () => {
  const output = await exportScript(emptyDefinition());
  for (const part of [
    "--login",
    "launchPersistentContext",
    "SCRAPER_PROFILE",
    "beforeNavigation",
    "results-",
  ])
    expect(output).toContain(part);
  // The downloaded file must parse: pasting the runner after the bundle once redeclared the engine's names.
  const dir = await mkdtemp(join(tmpdir(), "scrapepilot-export-"));
  try {
    await writeFile(join(dir, "scraper.mjs"), output);
    const check = spawnSync(process.execPath, ["--check", join(dir, "scraper.mjs")], {
      encoding: "utf8",
    });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
