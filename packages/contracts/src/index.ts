import { z } from "zod";
export const locatorSchema = z.object({
  primary: z.string().min(1).max(1000),
  fallbacks: z.array(z.string().max(1000)).max(5).default([]),
  frame: z.string().optional(),
  fingerprint: z
    .object({ tag: z.string(), text: z.string().optional() })
    .optional(),
});
export const fieldSchema = z.object({
  regex: z
    .object({
      pattern: z.string().max(250),
      group: z.number().int().min(0).max(20).default(0),
    })
    .optional(),
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  locator: locatorSchema,
  source: z.enum(["text", "attribute", "innerHTML"]).default("text"),
  attribute: z.string().optional(),
  type: z
    .enum(["string", "number", "boolean", "date", "url", "imageUrl"])
    .default("string"),
  required: z.boolean().default(false),
  trim: z.boolean().default(true),
});
const base = { id: z.string().min(1) };
export const stepSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("navigate"), url: z.string().max(2048) }),
  z.object({
    ...base,
    type: z.literal("fill"),
    locator: locatorSchema,
    value: z.string().max(4096),
  }),
  z.object({ ...base, type: z.literal("click"), locator: locatorSchema }),
  z.object({
    ...base,
    type: z.literal("select"),
    locator: locatorSchema,
    value: z.string(),
  }),
  z.object({ ...base, type: z.literal("waitFor"), locator: locatorSchema }),
  z.object({
    ...base,
    type: z.literal("extractCollection"),
    container: locatorSchema,
    fields: z.array(fieldSchema).min(1).max(50),
  }),
  z.object({
    ...base,
    type: z.literal("followEach"),
    linkField: z.string(),
    fields: z.array(fieldSchema).min(1).max(50),
  }),
  z.object({
    ...base,
    type: z.literal("paginate"),
    mode: z.enum(["next", "scroll"]),
    next: locatorSchema.optional(),
    maxPages: z.number().int().min(1).max(25),
  }),
]);
export const definitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(100),
    allowedDomains: z
      .array(z.string().regex(/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/))
      .min(1)
      .max(20),
    inputs: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
        z.object({
          type: z.enum(["text", "number", "boolean", "url", "secretRef"]),
          required: z.boolean().default(true),
          default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        }),
      )
      .default({}),
    steps: z.array(stepSchema).min(1).max(100),
    deduplicationKey: z.string().optional(),
    limits: z
      .object({
        maxPages: z.number().int().min(1).max(25).default(25),
        maxRows: z.number().int().min(1).max(1000).default(1000),
        timeoutMs: z.number().int().min(1000).max(900000).default(900000),
      })
      .default({ maxPages: 25, maxRows: 1000, timeoutMs: 900000 }),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const s of d.steps) {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", message: "Step IDs must be unique" });
      ids.add(s.id);
      if (s.type === "paginate" && s.mode === "next" && !s.next)
        ctx.addIssue({
          code: "custom",
          message: "Next pagination requires a locator",
        });
      if ("fields" in s) {
        const names = s.fields.map((f) => f.name);
        if (new Set(names).size !== names.length)
          ctx.addIssue({
            code: "custom",
            message: "Field names must be unique",
          });
      }
    }
    if (d.steps.filter((s) => s.type === "paginate").length > 1)
      ctx.addIssue({
        code: "custom",
        message: "Only one pagination block is supported",
      });
  });
export type ScraperDefinitionV1 = z.infer<typeof definitionSchema>;
export type LocatorSpec = z.infer<typeof locatorSchema>;
export type Field = z.infer<typeof fieldSchema>;
export const runStates = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "blocked",
  "failed",
  "canceled",
] as const;
export type RunState = (typeof runStates)[number];
export function validateInput(
  d: ScraperDefinitionV1,
  input: Record<string, unknown>,
) {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, s] of Object.entries(d.inputs)) {
    if (s.type === "secretRef") continue;
    const v = input[key] ?? s.default;
    if (v === undefined) {
      if (s.required) throw new Error(`Missing input: ${key}`);
      continue;
    }
    if (
      s.type === "number"
        ? typeof v !== "number"
        : s.type === "boolean"
          ? typeof v !== "boolean"
          : typeof v !== "string"
    )
      throw new Error(`Invalid input: ${key}`);
    if (s.type === "url") new URL(String(v));
    out[key] = v as string | number | boolean;
  }
  return out;
}
export function interpolate(
  template: string,
  input: Record<string, unknown>,
  secrets: Record<string, string> = {},
) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = key.startsWith("secret.") ? secrets[key.slice(7)] : input[key];
    if (v === undefined) throw new Error(`Missing variable: ${key}`);
    return String(v);
  });
}
export const emptyDefinition = (domain = "example.com"): ScraperDefinitionV1 =>
  definitionSchema.parse({
    schemaVersion: 1,
    name: "Untitled scraper",
    allowedDomains: [domain],
    inputs: { searchTerm: { type: "text", required: false, default: "" } },
    steps: [{ id: "open", type: "navigate", url: `https://${domain}` }],
  });
