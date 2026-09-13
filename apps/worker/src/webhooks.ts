import { Worker } from "bullmq";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { db, webhooks, webhookDeliveries, runs, eq } from "@scrapepilot/db";
import { decrypt, publicIp } from "@scrapepilot/scraper-engine/security";
const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};
export async function deliver(url: URL, body: string, signature: string) {
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  )
    throw new Error("Webhook requires public HTTPS");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => !publicIp(r.address)))
    throw new Error("Webhook destination is private");
  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent: false,
        lookup: ((_host: unknown, opts: any, cb: any) =>
          opts.all
            ? cb(null, [records[0]])
            : cb(null, records[0].address, records[0].family)) as any,
        timeout: 10000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-scrapepilot-signature": signature,
        },
      },
      (res) => {
        res.resume();
        if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300)
          resolve();
        else reject(new Error("Webhook rejected delivery"));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
const worker = new Worker(
  "webhooks",
  async (job) => {
    const [hook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, job.data.webhookId));
    if (!hook) {
      await db
        .update(webhookDeliveries)
        .set({ status: "revoked" })
        .where(eq(webhookDeliveries.id, job.id!));
      return;
    }
    const [run] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, job.data.runId));
    if (!run || run.ownerId !== hook.ownerId) return;
    const type =
      run.status === "succeeded"
        ? "run.completed"
        : run.status === "partial"
          ? "run.partial"
          : run.status === "blocked"
            ? "run.blocked"
            : "run.failed";
    const timestamp = Math.floor(Date.now() / 1000),
      body = JSON.stringify({
        id: job.id,
        type,
        runId: run.id,
        status: run.status,
        rowCount: run.rowCount,
        timestamp,
      });
    const key = decrypt(
      hook.encryptedKey,
      `${hook.ownerId}:webhook:${hook.id}`,
    );
    const signature = `t=${timestamp},v1=${createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")}`;
    await deliver(new URL(hook.url), body, signature);
    await db
      .update(webhookDeliveries)
      .set({ status: "delivered" })
      .where(eq(webhookDeliveries.id, job.id!));
  },
  { connection, concurrency: 2 },
);
worker.on("error", () => console.error("Webhook queue connection error"));
worker.on("failed", (job) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
    void db
      .update(webhookDeliveries)
      .set({ status: "failed" })
      .where(eq(webhookDeliveries.id, job.id!))
      .catch(() => console.error("Could not persist webhook failure"));
});
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, async () => {
    await worker.close();
    process.exit(0);
  });
