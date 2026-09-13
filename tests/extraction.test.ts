import { it, expect } from "vitest";
it("extracts a linear-time regex match", () =>
  expect(
    convert(
      "SKU: ABC-123",
      { ...f("string"), regex: { pattern: "[A-Z]+-[0-9]+", group: 0 } },
      "https://example.com",
    ),
  ).toBe("ABC-123"));
import { convert } from "../packages/scraper-engine/src/index";
import { fieldSchema } from "../packages/contracts/src/index";
const f = (type: string, required = false) =>
  fieldSchema.parse({
    name: "value",
    locator: { primary: ".price" },
    type,
    required,
  });
it("converts prices", () =>
  expect(convert("$1,299.95", f("number"), "https://example.com")).toBe(
    1299.95,
  ));
it("resolves relative product links", () =>
  expect(convert("/product/1", f("url"), "https://example.com/search")).toBe(
    "https://example.com/product/1",
  ));
it("keeps optional missing fields null", () =>
  expect(convert(null, f("string"), "https://example.com")).toBeNull());
it("fails required missing fields", () =>
  expect(() =>
    convert(null, f("string", true), "https://example.com"),
  ).toThrow());
it("does not execute HTML", () =>
  expect(
    convert("<script>alert(1)</script>", f("string"), "https://example.com"),
  ).toBe("<script>alert(1)</script>"));
it("rejects ambiguous booleans", () =>
  expect(() =>
    convert("possibly", f("boolean"), "https://example.com"),
  ).toThrow());
