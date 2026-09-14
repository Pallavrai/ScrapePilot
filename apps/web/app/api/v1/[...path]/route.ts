import { randomUUID, randomBytes } from "node:crypto";
import { publicationIssues } from "@scrapepilot/contracts/publishing";
import {
  db,
  scrapers,
  versions,
  runs,
  resultRows,
  apiKeys,
  secrets,
  listings,
  reports,
  user,
  policies,
  webhooks,
  webhookDeliveries,
  browserSessions,
  usageEvents,
  auditEvents,
  eq,
  and,
  desc,
  asc,
  sql,
  inArray,
} from "@scrapepilot/db";
import {
  definitionSchema,
  emptyDefinition,
  explainDefinitionError,
  validateInput,
} from "@scrapepilot/contracts";
import {
  encrypt,
  hash,
  assertPublicUrl,
} from "@scrapepilot/scraper-engine/security";
import { exportScript } from "@scrapepilot/scraper-engine/export";
import { LocalArtifactStore } from "@scrapepilot/scraper-engine/artifacts";
import {
  publicText,
  robotsConflict,
} from "@scrapepilot/scraper-engine/network";
import {
  identity,
  owned,
  getQueue,
  redis,
  HttpError,
  readBody,
} from "../../../../lib/server";
export const runtime = "nodejs";
// Spreadsheet apps run text cells starting with = + - @ as formulas, so those are prefixed with '.
const orderFields = (rows: Record<string, unknown>[], order: string[]) =>
  rows.map((row) =>
    Object.fromEntries([
      ...order.filter((key) => key in row).map((key) => [key, row[key]]),
      ...Object.entries(row).filter(([key]) => !order.includes(key)),
    ]),
  );
function toCsv(rows: Record<string, unknown>[], order: string[] = []) {
  const columns = [
    ...new Set([...order, ...rows.flatMap((row) => Object.keys(row))]),
  ];
  const cell = (value: unknown) => {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) || text !== text.trim()
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  };
  return (
    [columns, ...rows.map((row) => columns.map((c) => row[c]))]
      .map((line, index) =>
        (index === 0 ? (line as string[]).map((c) => cell(c)) : line.map(cell)).join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
// Two decimals, so a few seconds of browser time does not read as zero.
const usedMinutes = (ms: unknown) => Math.round(Number(ms) / 600) / 100;
async function handle(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const actor = await identity(req),
      [resource, id, action] = (await params).path,
      url = new URL(req.url),
      method = req.method;
    const body =
      method === "POST" || method === "PATCH" ? await readBody(req) : {};
    const json = (data: unknown, status = 200) =>
      Response.json(data, { status });
    if (resource === "me") {
      const [usage] = await db
        .select({ ms: sql<number>`coalesce(sum(${usageEvents.durationMs}),0)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.ownerId, actor.id),
            sql`${usageEvents.createdAt} >= date_trunc('month', now())`,
          ),
        );
      return json({
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
        monthlyMinutes: actor.monthlyMinutes,
        usedMinutes: usedMinutes(usage.ms),
      });
    }
    if (resource === "scrapers") {
      if (!id && method === "GET") {
        const list = await db
          .select()
          .from(scrapers)
          .where(eq(scrapers.ownerId, actor.id))
          .orderBy(desc(scrapers.updatedAt));
        const latest = await db
          .selectDistinctOn([runs.scraperId], {
            scraperId: runs.scraperId,
            status: runs.status,
            rowCount: runs.rowCount,
            createdAt: runs.createdAt,
          })
          .from(runs)
          .where(eq(runs.ownerId, actor.id))
          .orderBy(runs.scraperId, desc(runs.createdAt));
        const lastRuns = new Map(latest.map((r) => [r.scraperId, r]));
        return json(
          list.map((s) => ({ ...s, lastRun: lastRuns.get(s.id) ?? null })),
        );
      }
      if (!id && method === "POST") {
        const domain = new URL(body.url).hostname;
        await assertPublicUrl(body.url);
        const definition = emptyDefinition(domain);
        definition.steps = [{ id: "open", type: "navigate", url: body.url }];
        definition.name = String(body.name || domain).slice(0, 100);
        const [s] = await db
          .insert(scrapers)
          .values({
            id: randomUUID(),
            ownerId: actor.id,
            name: definition.name,
            draft: definition,
          })
          .returning();
        return json(s, 201);
      }
      const [s] = await db
        .select()
        .from(scrapers)
        .where(owned(scrapers, id, actor.id));
      if (!s) throw new HttpError(404, "Scraper not found");
      if (!action && method === "DELETE") {
        const templates = await db
          .select({ id: listings.id, status: listings.status })
          .from(listings)
          .innerJoin(versions, eq(listings.versionId, versions.id))
          .where(eq(versions.scraperId, id));
        if (templates.some((t) => t.status === "approved"))
          throw new HttpError(
            409,
            "This scraper has a public marketplace template. Ask an administrator to take it down before deleting the scraper.",
          );
        const [active] = await db
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              eq(runs.scraperId, id),
              sql`${runs.status} in ('queued','running')`,
            ),
          )
          .limit(1);
        if (active)
          throw new HttpError(
            409,
            "A run of this scraper is still in progress. Cancel it or wait for it to finish, then delete.",
          );
        const runIds = (
          await db
            .select({ id: runs.id })
            .from(runs)
            .where(eq(runs.scraperId, id))
        ).map((r) => r.id);
        await db.transaction(async (tx) => {
          const listingIds = templates.map((t) => t.id);
          if (listingIds.length) {
            await tx.delete(reports).where(inArray(reports.listingId, listingIds));
            await tx.delete(listings).where(inArray(listings.id, listingIds));
          }
          if (runIds.length)
            await tx
              .delete(webhookDeliveries)
              .where(inArray(webhookDeliveries.runId, runIds));
          await tx.delete(runs).where(eq(runs.scraperId, id)); // result rows cascade
          await tx.delete(browserSessions).where(eq(browserSessions.scraperId, id));
          await tx.delete(versions).where(eq(versions.scraperId, id));
          await tx.delete(scrapers).where(owned(scrapers, id, actor.id));
        });
        const store = new LocalArtifactStore(process.env.ARTIFACT_DIR ?? "artifacts");
        await Promise.all(runIds.map((runId) => store.delete(runId).catch(() => {})));
        return json({ deleted: true });
      }
      if (action === "session" && method === "DELETE") {
        await db
          .delete(browserSessions)
          .where(
            and(
              eq(browserSessions.ownerId, actor.id),
              eq(browserSessions.scraperId, id),
            ),
          );
        return json({ revoked: true });
      }
      if (action === "repair" && method === "POST") {
        const [run] = await db
          .select()
          .from(runs)
          .where(
            and(owned(runs, body.runId, actor.id), eq(runs.scraperId, id)),
          );
        if (!run) throw new HttpError(404, "Run not found");
        const [version] = await db
          .select()
          .from(versions)
          .where(eq(versions.id, run.versionId));
        await db
          .update(scrapers)
          .set({ draft: version.definition, updatedAt: new Date() })
          .where(owned(scrapers, id, actor.id));
        return json({
          definition: version.definition,
          error: run.error,
          runId: run.id,
        });
      }
      if (action === "upgrade") {
        if (!s.installedVersionId)
          throw new HttpError(
            409,
            "This scraper is not installed from a template",
          );
        const [old] = await db
          .select()
          .from(versions)
          .where(eq(versions.id, s.installedVersionId));
        if (!old)
          throw new HttpError(
            404,
            "The template this scraper came from is no longer available.",
          );
        const [next] = await db
          .select({ version: versions, listing: listings })
          .from(listings)
          .innerJoin(versions, eq(listings.versionId, versions.id))
          .where(
            and(
              eq(versions.scraperId, old.scraperId),
              eq(listings.status, "approved"),
              sql`${versions.number} > ${old.number}`,
            ),
          )
          .orderBy(desc(versions.number))
          .limit(1);
        if (!next)
          throw new HttpError(
            404,
            "You already have the latest approved version of this template.",
          );
        if (method === "POST") {
          if (body.versionId !== next.version.id)
            throw new HttpError(
              409,
              "Review the latest version before upgrading",
            );
          await db
            .update(scrapers)
            .set({
              draft: next.version.definition,
              installedVersionId: next.version.id,
              updatedAt: new Date(),
            })
            .where(owned(scrapers, id, actor.id));
        }
        return json({
          previous: old.definition,
          current: s.draft,
          proposed: next.version.definition,
          versionId: next.version.id,
          number: next.version.number,
        });
      }
      if (!action && method === "GET")
        return json({
          ...s,
          lastRun:
            (
              await db
                .select()
                .from(runs)
                .where(and(eq(runs.scraperId, id), eq(runs.ownerId, actor.id)))
                .orderBy(desc(runs.createdAt))
                .limit(1)
            )[0] ?? null,
          versions: await db
            .select()
            .from(versions)
            .where(eq(versions.scraperId, id))
            .orderBy(desc(versions.number)),
        });
      if (!action && method === "PATCH") {
        const definition = definitionSchema.parse(body.definition);
        await db
          .update(scrapers)
          .set({
            draft: definition,
            name: definition.name,
            updatedAt: new Date(),
          })
          .where(owned(scrapers, id, actor.id));
        return json({ saved: true });
      }
      if (action === "versions" && method === "POST") {
        const definition = definitionSchema.parse(s.draft);
        const version = await db.transaction(async (tx) => {
          await tx.execute(
            sql`select id from scrapers where id=${id} for update`,
          );
          const [last] = await tx
            .select()
            .from(versions)
            .where(eq(versions.scraperId, id))
            .orderBy(desc(versions.number))
            .limit(1);
          const [v] = await tx
            .insert(versions)
            .values({
              id: randomUUID(),
              scraperId: id,
              number: (last?.number ?? 0) + 1,
              definition,
            })
            .returning();
          return v;
        });
        return json(version, 201);
      }
      if (action === "input-schema")
        return json(definitionSchema.parse(s.draft).inputs);
      if (action === "export") {
        const [v] = await db
          .select()
          .from(versions)
          .where(
            and(
              eq(versions.scraperId, id),
              url.searchParams.has("version")
                ? eq(versions.number, Number(url.searchParams.get("version")))
                : undefined,
            ),
          )
          .orderBy(desc(versions.number))
          .limit(1);
        if (!v) throw new HttpError(409, "Save a version first");
        return new Response(
          await exportScript(definitionSchema.parse(v.definition)),
          {
            headers: {
              "content-type": "text/plain",
              "content-disposition": 'attachment; filename="scraper.mjs"',
            },
          },
        );
      }
      if (action === "runs" && method === "POST") {
        const [v] = await db
          .select()
          .from(versions)
          .where(
            and(
              eq(versions.scraperId, id),
              body.version ? eq(versions.number, body.version) : undefined,
            ),
          )
          .orderBy(desc(versions.number))
          .limit(1);
        if (!v) throw new HttpError(409, "Save a version first");
        const input = validateInput(
            definitionSchema.parse(v.definition),
            body.input ?? {},
          ),
          requestHash = hash(JSON.stringify({ version: v.id, input })),
          key = req.headers.get("idempotency-key");
        if (key && key.length > 200)
          throw new HttpError(400, "Idempotency key too long");
        const run = await db.transaction(async (tx) => {
          await tx.execute(
            sql`select id from "user" where id=${actor.id} for update`,
          );
          if (key) {
            const [previous] = await tx
              .select()
              .from(runs)
              .where(
                and(eq(runs.ownerId, actor.id), eq(runs.idempotencyKey, key)),
              );
            if (previous) {
              if (previous.requestHash !== requestHash)
                throw new HttpError(
                  409,
                  "Idempotency key already used for different inputs",
                );
              return previous;
            }
          }
          const [active] = await tx
            .select()
            .from(runs)
            .where(
              and(
                eq(runs.ownerId, actor.id),
                sql`${runs.status} in ('queued','running')`,
              ),
            )
            .limit(1);
          if (active)
            throw new HttpError(
              429,
              "A run is already in progress for your account. Wait for it to finish or cancel it in Run history.",
            );
          const [usage] = await tx
            .select({
              ms: sql<number>`coalesce(sum(${usageEvents.durationMs}),0)`,
            })
            .from(usageEvents)
            .where(
              and(
                eq(usageEvents.ownerId, actor.id),
                sql`${usageEvents.createdAt} >= date_trunc('month', now())`,
              ),
            );
          if (Number(usage.ms) > actor.monthlyMinutes * 60000 - 1000)
            throw new HttpError(429, "Monthly browser quota exhausted");
          const [r] = await tx
            .insert(runs)
            .values({
              id: randomUUID(),
              ownerId: actor.id,
              scraperId: id,
              versionId: v.id,
              input,
              requestHash,
              idempotencyKey: key,
            })
            .returning();
          await tx.insert(usageEvents).values({
            id: r.id,
            ownerId: actor.id,
            kind: "run-reserved",
            durationMs: Math.min(
              definitionSchema.parse(v.definition).limits.timeoutMs,
              actor.monthlyMinutes * 60000 - Number(usage.ms),
            ),
          });
          return r;
        });
        await getQueue().add(
          "execute",
          { runId: run.id },
          { jobId: run.id, removeOnComplete: 1000, removeOnFail: 1000 },
        );
        return json({ runId: run.id, status: run.status }, 202);
      }
      if (action === "browser" && method === "POST") {
        const token = randomBytes(32).toString("hex"),
          reservationId = hash(token);
        const lock = await redis.set(
          `browser-owner:${actor.id}`,
          token,
          "EX",
          900,
          "NX",
        );
        if (!lock)
          throw new HttpError(
            429,
            "A browser session is already open for your account, in another tab or still closing. Close it or wait a few seconds, then retry.",
          );
        try {
          const budgetMs = await db.transaction(async (tx) => {
            await tx.execute(
              sql`select id from "user" where id=${actor.id} for update`,
            );
            const [usage] = await tx
              .select({
                ms: sql<number>`coalesce(sum(${usageEvents.durationMs}),0)`,
              })
              .from(usageEvents)
              .where(
                and(
                  eq(usageEvents.ownerId, actor.id),
                  sql`${usageEvents.createdAt}>=date_trunc('month',now())`,
                ),
              );
            const budget = Math.min(
              900000,
              actor.monthlyMinutes * 60000 - Number(usage.ms),
            );
            if (budget < 1000)
              throw new HttpError(429, "Monthly browser quota exhausted");
            await tx.insert(usageEvents).values({
              id: reservationId,
              ownerId: actor.id,
              kind: "browser-pending",
              durationMs: budget,
            });
            return budget;
          });
          await redis.set(
            `browser-token:${reservationId}`,
            JSON.stringify({
              ownerId: actor.id,
              scraperId: id,
              definition: s.draft,
              budgetMs,
            }),
            "EX",
            60,
          );
          return json({
            token,
            url:
              process.env.WORKER_PUBLIC_URL ??
              process.env.NEXT_PUBLIC_WORKER_URL ??
              "ws://localhost:3001/browser",
          });
        } catch (error) {
          await redis.del(`browser-owner:${actor.id}`);
          await db
            .delete(usageEvents)
            .where(
              and(
                eq(usageEvents.id, reservationId),
                eq(usageEvents.kind, "browser-pending"),
              ),
            );
          throw error;
        }
      }
    }
    if (resource === "runs") {
      if (!id) {
        const list = await db
          .select({ run: runs, scraperName: scrapers.name })
          .from(runs)
          .innerJoin(scrapers, eq(runs.scraperId, scrapers.id))
          .where(eq(runs.ownerId, actor.id))
          .orderBy(desc(runs.createdAt))
          .limit(100);
        const counts = list.length
          ? await db
              .select({ runId: resultRows.runId, stored: sql<number>`count(*)` })
              .from(resultRows)
              .where(inArray(resultRows.runId, list.map((r) => r.run.id)))
              .groupBy(resultRows.runId)
          : [];
        const stored = new Map(counts.map((c) => [c.runId, Number(c.stored)]));
        const store = new LocalArtifactStore(process.env.ARTIFACT_DIR ?? "artifacts");
        return json(
          await Promise.all(
            list.map(async ({ run, scraperName }) => ({
              ...run,
              scraperName,
              storedRows: stored.get(run.id) ?? 0,
              hasScreenshot: await store.has(run.id, "png"),
            })),
          ),
        );
      }
      const [r] = await db
        .select()
        .from(runs)
        .where(owned(runs, id, actor.id));
      if (!r) throw new HttpError(404, "Run not found");
      if (action === "artifact" && method === "GET") {
        try {
          const content = await new LocalArtifactStore(
            process.env.ARTIFACT_DIR ?? "artifacts",
          ).get(id, "png");
          return new Response(new Uint8Array(content), {
            headers: {
              "content-type": "image/png",
              "cache-control": "private, no-store",
            },
          });
        } catch {
          throw new HttpError(404, "No diagnostic screenshot available");
        }
      }
      if (action === "results" && method === "DELETE") {
        await db.delete(resultRows).where(eq(resultRows.runId, id));
        await new LocalArtifactStore(
          process.env.ARTIFACT_DIR ?? "artifacts",
        ).delete(id);
        return json({ deleted: true });
      }
      if (action === "cancel" && method === "POST") {
        await redis.set(`cancel:${id}`, "1", "EX", 3600);
        const canceled = await db
          .update(runs)
          .set({ status: "canceled", finishedAt: new Date() })
          .where(and(owned(runs, id, actor.id), eq(runs.status, "queued")))
          .returning();
        if (canceled.length)
          await db
            .update(usageEvents)
            .set({ kind: "run", durationMs: 0 })
            .where(eq(usageEvents.id, id));
        return json({ canceled: true });
      }
      if (action === "results") {
        // Rows are stored as jsonb, which reorders keys; use the field order of the version that ran.
        const [ran] = await db
          .select({ definition: versions.definition })
          .from(versions)
          .where(eq(versions.id, r.versionId));
        const fieldOrder: string[] = ((ran?.definition as any)?.steps ?? []).flatMap(
          (s: any) => (Array.isArray(s.fields) ? s.fields.map((f: any) => f.name) : []),
        );
        const format = url.searchParams.get("format");
        if (format === "csv" || format === "json") {
          const all = orderFields((
            await db
              .select({ data: resultRows.data })
              .from(resultRows)
              .where(eq(resultRows.runId, id))
              .orderBy(asc(resultRows.position))
          ).map((row) => row.data as Record<string, unknown>), fieldOrder);
          return new Response(
            format === "csv" ? toCsv(all, fieldOrder) : JSON.stringify(all, null, 2),
            {
              headers: {
                "content-type":
                  format === "csv" ? "text/csv; charset=utf-8" : "application/json",
                "content-disposition": `attachment; filename="run-${id.slice(0, 8)}.${format}"`,
                "cache-control": "private, no-store",
              },
            },
          );
        }
        const cursor = Number(url.searchParams.get("cursor") ?? 0),
          limit = Math.min(
            1000,
            Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
          );
        if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit))
          throw new HttpError(400, "Invalid pagination");
        const rows = await db
          .select()
          .from(resultRows)
          .where(
            and(
              eq(resultRows.runId, id),
              sql`${resultRows.position} >= ${cursor}`,
            ),
          )
          .orderBy(asc(resultRows.position))
          .limit(limit + 1);
        return json({
          rows: orderFields(
            rows.slice(0, limit).map((row) => row.data as Record<string, unknown>),
            fieldOrder,
          ),
          nextCursor: rows.length > limit ? cursor + limit : null,
        });
      }
      return json(r);
    }
    if (resource === "webhooks") {
      if (method === "GET") {
        const hooks = await db
          .select({
            id: webhooks.id,
            url: webhooks.url,
            createdAt: webhooks.createdAt,
          })
          .from(webhooks)
          .where(eq(webhooks.ownerId, actor.id));
        const deliveries = hooks.length
          ? await db
              .select({
                webhookId: webhookDeliveries.webhookId,
                runId: webhookDeliveries.runId,
                status: webhookDeliveries.status,
                createdAt: webhookDeliveries.createdAt,
              })
              .from(webhookDeliveries)
              .where(inArray(webhookDeliveries.webhookId, hooks.map((h) => h.id)))
              .orderBy(desc(webhookDeliveries.createdAt))
              .limit(200)
          : [];
        return json(
          hooks.map((h) => ({
            ...h,
            deliveries: deliveries.filter((d) => d.webhookId === h.id).slice(0, 5),
          })),
        );
      }
      if (method === "DELETE") {
        await db.delete(webhooks).where(owned(webhooks, id, actor.id));
        return json({ revoked: true });
      }
      if (method === "POST") {
        const target = await assertPublicUrl(body.url);
        if (target.protocol !== "https:")
          throw new HttpError(400, "Webhook must use HTTPS");
        const hookId = randomUUID(),
          key = randomBytes(32).toString("hex");
        await db.insert(webhooks).values({
          id: hookId,
          ownerId: actor.id,
          url: target.href,
          encryptedKey: encrypt(key, `${actor.id}:webhook:${hookId}`),
        });
        return json({ id: hookId, signingKey: key }, 201);
      }
    }
    if (resource === "keys") {
      if (method === "GET")
        return json(
          await db
            .select({
              id: apiKeys.id,
              name: apiKeys.name,
              prefix: apiKeys.prefix,
              createdAt: apiKeys.createdAt,
            })
            .from(apiKeys)
            .where(eq(apiKeys.ownerId, actor.id)),
        );
      if (method === "DELETE") {
        await db.delete(apiKeys).where(owned(apiKeys, id, actor.id));
        return json({ deleted: true });
      }
      if (method === "POST") {
        const token = `sp_${randomBytes(32).toString("hex")}`;
        await db.insert(apiKeys).values({
          id: randomUUID(),
          ownerId: actor.id,
          name: String(body.name || "API key").slice(0, 100),
          hash: hash(token),
          prefix: token.slice(0, 10),
        });
        return json({ token }, 201);
      }
    }
    if (resource === "secrets") {
      if (method === "GET")
        return json(
          await db
            .select({
              id: secrets.id,
              name: secrets.name,
              domain: secrets.domain,
            })
            .from(secrets)
            .where(eq(secrets.ownerId, actor.id)),
        );
      if (method === "DELETE") {
        await db.delete(secrets).where(owned(secrets, id, actor.id));
        return json({ deleted: true });
      }
      if (method === "POST") {
        const name = String(body.name ?? ""),
          domain = /^[a-z0-9.-]+$/i.test(String(body.domain ?? ""))
            ? String(body.domain).toLowerCase()
            : "";
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name))
          throw new HttpError(
            400,
            "Credential names start with a letter and use only letters, numbers and _.",
          );
        if (!domain)
          throw new HttpError(
            400,
            "Enter the site's domain, like example.com, without https:// or a path.",
          );
        if (typeof body.value !== "string" || !body.value || body.value.length > 4096)
          throw new HttpError(400, "Enter a secret value of up to 4096 characters.");
        await assertPublicUrl(`https://${domain}`);
        const [existing] = await db
          .select({ id: secrets.id })
          .from(secrets)
          .where(
            and(
              eq(secrets.ownerId, actor.id),
              eq(secrets.domain, domain),
              eq(secrets.name, name),
            ),
          );
        if (existing)
          throw new HttpError(
            409,
            `A credential named ${name} already exists for ${domain}. Revoke it first to replace it.`,
          );
        const secretId = randomUUID();
        await db.insert(secrets).values({
          id: secretId,
          ownerId: actor.id,
          name,
          domain,
          encrypted: encrypt(body.value, `${actor.id}:${domain}:${name}`),
        });
        return json({ id: secretId }, 201);
      }
    }
    if (resource === "marketplace") {
      if (!id && method === "GET")
        return json(
          await db
            .select({
              id: listings.id,
              name: listings.name,
              description: listings.description,
              installCount: listings.installCount,
              changelog: listings.changelog,
              sampleOutput: listings.sampleOutput,
              version: versions.number,
              creator: user.name,
              inputs: sql`${versions.definition}->'inputs'`,
              domains: sql`${versions.definition}->'allowedDomains'`,
            })
            .from(listings)
            .innerJoin(versions, eq(listings.versionId, versions.id))
            .innerJoin(user, eq(listings.ownerId, user.id))
            .where(
              and(
                eq(listings.status, "approved"),
                // One card per template: hide versions replaced by a newer approved one.
                sql`not exists (select 1 from listings l2 join versions v2 on v2.id = l2.version_id where l2.status = 'approved' and v2.scraper_id = ${versions.scraperId} and v2.number > ${versions.number})`,
              ),
            )
            .orderBy(desc(listings.createdAt)),
        );
      if (!id && method === "POST") {
        if (body.attestation !== true)
          throw new HttpError(400, "Authorization attestation required");
        const [v] = await db
          .select({ v: versions, s: scrapers })
          .from(versions)
          .innerJoin(scrapers, eq(versions.scraperId, scrapers.id))
          .where(
            and(
              eq(versions.id, body.versionId),
              eq(scrapers.ownerId, actor.id),
            ),
          );
        if (!v) throw new HttpError(404, "Version not found");
        const d = definitionSchema.parse(v.v.definition);
        const issues = publicationIssues(d);
        if (issues.length) throw new HttpError(400, issues.join("; "));
        if (
          !Array.isArray(body.sampleOutput ?? []) ||
          JSON.stringify(body.sampleOutput ?? []).length > 10000
        )
          throw new HttpError(
            400,
            "Sample output must be a JSON array under 10 KB",
          );
        for (const domain of d.allowedDomains) {
          await assertPublicUrl(`https://${domain}`);
          const robots = await publicText(`https://${domain}/robots.txt`).catch(
            () => null,
          );
          if (robots?.status === 200 && robotsConflict(robots.text))
            throw new HttpError(
              400,
              `${domain} robots.txt disallows this crawler at /. Resolve target access before publishing.`,
            );
          const [p] = await db
            .select()
            .from(policies)
            .where(eq(policies.domain, domain));
          if (p?.blocked) throw new HttpError(400, "Domain is blocked");
        }
        for (const step of d.steps)
          if (
            step.type === "fill" &&
            /password|token|secret/i.test(step.locator.primary) &&
            !/^\{\{secret\.\w+\}\}$/.test(step.value)
          )
            throw new HttpError(
              400,
              "Use secret references for sensitive fields",
            );
        const [listing] = await db
          .insert(listings)
          .values({
            id: randomUUID(),
            ownerId: actor.id,
            versionId: v.v.id,
            name: d.name,
            description: String(body.description ?? "").slice(0, 2000),
            changelog: String(body.changelog ?? "Initial version").slice(
              0,
              2000,
            ),
            sampleOutput: body.sampleOutput ?? [],
          })
          .returning();
        return json(listing, 201);
      }
      const [listing] = await db
        .select()
        .from(listings)
        .where(and(eq(listings.id, id), eq(listings.status, "approved")));
      if (!listing) throw new HttpError(404, "Listing not found");
      if (action === "install" && method === "POST") {
        const [v] = await db
          .select()
          .from(versions)
          .where(eq(versions.id, listing.versionId));
        const d = definitionSchema.parse(v.definition);
        const sid = randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(scrapers).values({
            id: sid,
            ownerId: actor.id,
            name: d.name,
            draft: d,
            installedVersionId: v.id,
          });
          await tx
            .update(listings)
            .set({ installCount: sql`${listings.installCount}+1` })
            .where(eq(listings.id, id));
        });
        return json({ id: sid }, 201);
      }
      if (action === "report" && method === "POST") {
        const reason = String(body.reason ?? "").trim();
        if (reason.length < 10)
          throw new HttpError(
            400,
            "Describe the problem in at least 10 characters so an administrator can act on it.",
          );
        await db.insert(reports).values({
          id: randomUUID(),
          ownerId: actor.id,
          listingId: id,
          reason: reason.slice(0, 2000),
        });
        return json({ reported: true });
      }
      return json(listing);
    }
    if (resource === "admin") {
      if (actor.role !== "admin")
        throw new HttpError(403, "Administrator access required");
      if (id === "domains") {
        if (method === "GET") return json(await db.select().from(policies));
        if (method === "POST") {
          const domain = new URL(`https://${body.domain}`).hostname;
          await db
            .insert(policies)
            .values({ domain, blocked: !!body.blocked })
            .onConflictDoUpdate({
              target: policies.domain,
              set: { blocked: !!body.blocked },
            });
          await db.insert(auditEvents).values({
            id: randomUUID(),
            ownerId: actor.id,
            action: "domain-policy",
            resourceId: domain,
          });
          return json({ updated: true });
        }
      }
      if (id === "reports" && method === "GET")
        return json(
          await db
            .select({
              id: reports.id,
              listingId: reports.listingId,
              reason: reports.reason,
              createdAt: reports.createdAt,
              listingName: listings.name,
              listingStatus: listings.status,
            })
            .from(reports)
            .innerJoin(listings, eq(reports.listingId, listings.id))
            .orderBy(desc(reports.createdAt))
            .limit(100),
        );
      if (id === "listings") {
        if (method === "GET")
          return json(
            await db
              .select({
                listing: listings,
                definition: versions.definition,
                version: versions.number,
                creator: user.email,
              })
              .from(listings)
              .innerJoin(versions, eq(listings.versionId, versions.id))
              .innerJoin(user, eq(listings.ownerId, user.id))
              .orderBy(desc(listings.createdAt)),
          );
        if (method === "POST") {
          if (!["approved", "rejected"].includes(body.status))
            throw new HttpError(400, "Invalid review status");
          if (body.status === "rejected" && !String(body.note ?? "").trim())
            throw new HttpError(
              400,
              "Add a review note explaining why the template is rejected.",
            );
          await db
            .update(listings)
            .set({ status: body.status, reviewNote: String(body.note ?? "") })
            .where(eq(listings.id, body.id));
          await db.insert(auditEvents).values({
            id: randomUUID(),
            ownerId: actor.id,
            action: `listing-${body.status}`,
            resourceId: String(body.id),
          });
          return json({ updated: true });
        }
      }
      if (id === "users") {
        if (method === "GET")
        {
          const usage = await db
            .select({
              ownerId: usageEvents.ownerId,
              ms: sql<number>`coalesce(sum(${usageEvents.durationMs}),0)`,
            })
            .from(usageEvents)
            .where(sql`${usageEvents.createdAt} >= date_trunc('month', now())`)
            .groupBy(usageEvents.ownerId);
          const used = new Map(usage.map((u) => [u.ownerId, usedMinutes(u.ms)]));
          const people = await db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              suspended: user.suspended,
              monthlyMinutes: user.monthlyMinutes,
            })
            .from(user)
            .orderBy(user.email)
            .limit(500);
          return json(people.map((u) => ({ ...u, usedMinutes: used.get(u.id) ?? 0 })));
        }
        if (method === "POST") {
          await db
            .update(user)
            .set({
              suspended: !!body.suspended,
              monthlyMinutes: Math.max(
                0,
                Math.min(
                  10000,
                  Number.isFinite(Number(body.monthlyMinutes))
                    ? Number(body.monthlyMinutes)
                    : 100,
                ),
              ),
            })
            .where(eq(user.id, body.id));
          return json({ updated: true });
        }
      }
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    if (e instanceof HttpError)
      return Response.json({ error: e.message }, { status: e.status });
    if (
      e instanceof Error &&
      (e.name === "ZodError" ||
        /input|variable|URL|Domain|Private|Invalid/i.test(e.message))
    )
      return Response.json(
        { error: explainDefinitionError(e) },
        { status: 400 },
      );
    console.error(
      "API request failed",
      e instanceof Error ? e.name : "Unknown error",
    );
    return Response.json(
      { error: "Request failed. Check server configuration and retry." },
      { status: 500 },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
