import { Worker, type ConnectionOptions } from "bullmq";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import { db, webhooks, webhookDeliveries, runs, eq } from "@scrapepilot/db";
import { decrypt, publicIp } from "@scrapepilot/scraper-engine/security";
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
/** The scheme documented for receivers: HMAC-SHA256 of "timestamp.body". */
export const sign = (key: string, timestamp: number, body: string) =>
  `t=${timestamp},v1=${createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")}`;
const setStatus = (id: string, status: string) =>
  db
    .update(webhookDeliveries)
    .set({ status })
    .where(eq(webhookDeliveries.id, id));
export async function processDelivery(
  deliveryId: string,
  data: { webhookId: string; runId: string },
  send = deliver,
) {
  const [hook] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, data.webhookId));
  const [run] = await db.select().from(runs).where(eq(runs.id, data.runId));
  // Nothing left to send; a pending row would be requeued by reconciliation forever.
  if (!hook || !run || run.ownerId !== hook.ownerId) {
    await setStatus(deliveryId, "revoked");
    return;
  }
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
      id: deliveryId,
      type,
      runId: run.id,
      status: run.status,
      rowCount: run.rowCount,
      timestamp,
    });
  const key = decrypt(hook.encryptedKey, `${hook.ownerId}:webhook:${hook.id}`);
  await send(new URL(hook.url), body, sign(key, timestamp, body));
  await setStatus(deliveryId, "delivered");
}
export function startDeliveryWorker(
  queue: string,
  connection: ConnectionOptions,
  send = deliver,
) {
  const worker = new Worker(
    queue,
    (job) => processDelivery(job.id!, job.data, send),
    { connection, concurrency: 2 },
  );
  worker.on("error", () => console.error("Webhook queue connection error"));
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void setStatus(job.id!, "failed").catch(() =>
        console.error("Could not persist webhook failure"),
      );
  });
  return worker;
}
