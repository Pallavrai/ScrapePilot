import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export * from "./schema";
export { eq, and, desc, asc, sql, lt, inArray } from "drizzle-orm";
export const client = postgres(
  process.env.DATABASE_URL ??
    "postgres://scrapepilot:scrapepilot@localhost:5432/scrapepilot",
  { max: 10 },
);
export const db = drizzle(client, { schema });
