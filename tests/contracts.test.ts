import { describe, it, expect } from "vitest";
import {
  definitionSchema,
  emptyDefinition,
  interpolate,
  validateInput,
} from "../packages/contracts/src/index";
describe("workflow contract", () => {
  it("accepts bounded public workflows", () =>
    expect(definitionSchema.parse(emptyDefinition()).schemaVersion).toBe(1));
  it("rejects unbounded workloads", () =>
    expect(() =>
      definitionSchema.parse({
        ...emptyDefinition(),
        limits: { maxPages: 999, maxRows: 999999, timeoutMs: 9999999 },
      }),
    ).toThrow());
  it("rejects missing next locator", () =>
    expect(() =>
      definitionSchema.parse({
        ...emptyDefinition(),
        steps: [{ id: "page", type: "paginate", mode: "next", maxPages: 5 }],
      }),
    ).toThrow());
  it("rejects duplicated step identities", () =>
    expect(() =>
      definitionSchema.parse({
        ...emptyDefinition(),
        steps: [...emptyDefinition().steps, ...emptyDefinition().steps],
      }),
    ).toThrow());
  it("interpolates inputs separately from secret references", () =>
    expect(
      interpolate(
        "{{searchTerm}}:{{secret.password}}",
        { searchTerm: "toy" },
        { password: "private" },
      ),
    ).toBe("toy:private"));
  it("fails on missing variables", () =>
    expect(() => interpolate("{{missing}}", {})).toThrow());
  it("validates input types", () =>
    expect(() =>
      validateInput(
        {
          ...emptyDefinition(),
          inputs: { pages: { type: "number", required: true } },
        },
        { pages: "bad" },
      ),
    ).toThrow());
});
