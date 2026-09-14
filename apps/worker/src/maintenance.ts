import type { Queue } from "bullmq";
import { db, runs, webhookDeliveries, eq, asc, sql } from "@scrapepilot/db";
import type { ArtifactStore } from "@scrapepilot/scraper-engine/artifacts";
type Enqueue = Pick<Queue, "add">;
export const deliveryJob = {
  attempts: 4,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};
/**
 * Fails runs whose worker died, charges only the time they ran (capped at their
 * reservation) and records their webhook deliveries for reconciliation to send.
 * Browser runs are not the worker's: they are given up only after 20 minutes, longer
 * than any run's 15-minute limit, and keep the rows their browser already uploaded.
 */
export async function failInterruptedRuns(olderThanMinutes: number) {
  await db.execute(sql`
    with lost as (
      update runs set status = case when source = 'browser' and row_count > 0 then 'partial' else 'failed' end, finished_at = now(),
        error = jsonb_build_object('message', case when source = 'browser'
          then 'The browser stopped sending updates during this run. Start the run again.'
          else 'The worker stopped during this run. Start the run again.' end)
      where status = 'running'
        and started_at < now() - greatest(${olderThanMinutes}::int, case when source = 'browser' then 20 else 0 end) * interval '1 minute'
      returning id, owner_id, started_at
    ), charged as (
      update usage_events u set kind = 'run',
        duration_ms = least(u.duration_ms, greatest(0, (extract(epoch from now() - lost.started_at) * 1000)::int))
      from lost where u.id = lost.id and u.kind = 'run-reserved'
    )
    insert into webhook_deliveries (id, webhook_id, run_id)
    select lost.id || '-' || w.id, w.id, lost.id from lost join webhooks w on w.owner_id = lost.owner_id
    on conflict do nothing`);
}
/** Recovers database-backed work after a Redis outage, a failed enqueue or a lost worker. */
export async function reconcile(runQueue: Enqueue, deliveryQueue: Enqueue) {
  await db.execute(
    sql`update usage_events set duration_ms=0,kind='browser-expired' where kind='browser-pending' and created_at<now()-interval '90 seconds'`,
  );
  await db.execute(sql`delete from browser_sessions where expires_at<now()`);
  await failInterruptedRuns(20);
  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.status, "pending"))
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(100);
  for (const delivery of deliveries)
    await deliveryQueue.add(
      "deliver",
      { webhookId: delivery.webhookId, runId: delivery.runId },
      { jobId: delivery.id, ...deliveryJob },
    );
  const pending = await db
    .select()
    .from(runs)
    .where(eq(runs.status, "queued"))
    .limit(100);
  for (const run of pending)
    await runQueue.add(
      "execute",
      { runId: run.id },
      { jobId: run.id, removeOnComplete: 1000 },
    );
}
/** Results are kept for 30 days and failure screenshots for seven. */
export async function applyRetention(store: ArtifactStore) {
  await db.execute(
    sql`delete from result_rows where run_id in (select id from runs where created_at<now()-interval '30 days')`,
  );
  await store.prune(new Date(Date.now() - 7 * 86400000));
}
