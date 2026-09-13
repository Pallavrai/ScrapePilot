import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  suspended: boolean("suspended").default(false).notNull(),
  role: text("role").default("user").notNull(),
  monthlyMinutes: integer("monthly_minutes").default(100).notNull(),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: created(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: created(),
  updatedAt: timestamp("updated_at").notNull(),
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: created(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const scrapers = pgTable("scrapers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  draft: jsonb("draft").notNull(),
  installedVersionId: text("installed_version_id"),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const versions = pgTable(
  "versions",
  {
    id: text("id").primaryKey(),
    scraperId: text("scraper_id")
      .notNull()
      .references(() => scrapers.id),
    number: integer("number").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("version_number").on(t.scraperId, t.number)],
);
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    scraperId: text("scraper_id")
      .notNull()
      .references(() => scrapers.id),
    versionId: text("version_id")
      .notNull()
      .references(() => versions.id),
    input: jsonb("input").notNull(),
    status: text("status").default("queued").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash").notNull(),
    error: jsonb("error"),
    rowCount: integer("row_count").default(0).notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    createdAt: created(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("run_idempotency").on(t.ownerId, t.idempotencyKey)],
);
export const resultRows = pgTable(
  "result_rows",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [uniqueIndex("row_position").on(t.runId, t.position)],
);
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  hash: text("hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: created(),
});
export const secrets = pgTable(
  "secrets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    domain: text("domain").notNull(),
    name: text("name").notNull(),
    encrypted: text("encrypted").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("secret_name").on(t.ownerId, t.domain, t.name)],
);
export const listings = pgTable("listings", {
  changelog: text("changelog").default("").notNull(),
  sampleOutput: jsonb("sample_output").default([]).notNull(),
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  versionId: text("version_id")
    .notNull()
    .references(() => versions.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").default("pending").notNull(),
  reviewNote: text("review_note"),
  installCount: integer("install_count").default(0).notNull(),
  createdAt: created(),
});
export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  reason: text("reason").notNull(),
  createdAt: created(),
});
export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  url: text("url").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: created(),
});
export const policies = pgTable("policies", {
  domain: text("domain").primaryKey(),
  blocked: boolean("blocked").default(false).notNull(),
});
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  status: text("status").default("pending").notNull(),
  createdAt: created(),
});
export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    scraperId: text("scraper_id")
      .notNull()
      .references(() => scrapers.id),
    encrypted: text("encrypted").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("browser_session_owner").on(t.ownerId, t.scraperId)],
);
export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id),
  kind: text("kind").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: created(),
});
export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  action: text("action").notNull(),
  resourceId: text("resource_id").notNull(),
  createdAt: created(),
});
