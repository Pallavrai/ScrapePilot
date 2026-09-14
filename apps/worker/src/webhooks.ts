import { startDeliveryWorker } from "./delivery";
const worker = startDeliveryWorker("webhooks", {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, async () => {
    await worker.close();
    process.exit(0);
  });
