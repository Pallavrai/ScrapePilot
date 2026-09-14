import type { Field } from "@scrapepilot/contracts";
import { RE2JS } from "re2js";
// No Playwright here: the browser extension bundles this so both runners convert values the same way.
export function convert(
  value: string | null,
  field: Field,
  url: string,
): unknown {
  if (value === null || value === "") {
    if (field.required)
      throw new Error(`Required field missing: ${field.name}`);
    return null;
  }
  let v = field.trim ? value.trim() : value;
  if (field.regex) {
    const matcher = RE2JS.compile(field.regex.pattern).matcher(v);
    if (!matcher.find()) {
      if (field.required)
        throw new Error(`Pattern did not match: ${field.name}`);
      return null;
    }
    v = matcher.group(field.regex.group) ?? "";
  }
  switch (field.type) {
    case "number": {
      const numeric = v.replace(/[^\d.,+-]/g, "").replace(/,/g, "");
      if (!/\d/.test(numeric)) throw new Error(`Invalid number: ${field.name}`);
      const n = Number(numeric);
      if (!Number.isFinite(n)) throw new Error(`Invalid number: ${field.name}`);
      return n;
    }
    case "boolean":
      if (/^(true|yes|1)$/i.test(v)) return true;
      if (/^(false|no|0)$/i.test(v)) return false;
      throw new Error(`Invalid boolean: ${field.name}`);
    case "date": {
      const date = new Date(v);
      if (Number.isNaN(date.getTime()))
        throw new Error(`Invalid date: ${field.name}`);
      return date.toISOString();
    }
    case "url":
    case "imageUrl":
      return new URL(v, url).href;
    default:
      return v;
  }
}
