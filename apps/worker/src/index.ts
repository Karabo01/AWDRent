import { env } from "@awdrent/config";
import { markScanFailed, scanDocument, stalePendingDocuments } from "@awdrent/core/documents";
import { DOCUMENTS_QUEUE, enqueueScan, MAINTENANCE_QUEUE, redisConnection, type ScanJob } from "@awdrent/core/queue";
import { snapshotUsage } from "@awdrent/core/usage";
import { closeDb, schema, withPlatform } from "@awdrent/db";
import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";

// Background worker. Every job names its agency, and all agency data is read
// and written inside withAgency() for that agency only.
//
// Queues:
//   documents    virus scan, then promote or delete (retried 5×, then marked failed)
//   maintenance  repeatable: re-queue stuck scans (every 5 min), usage snapshot (nightly)

const config = env();
const connection = redisConnection();
const clamd = { host: config.CLAMAV_HOST, port: config.CLAMAV_PORT };

async function activeAgencyIds(): Promise<string[]> {
  const rows = await withPlatform((tx) =>
    tx.select({ id: schema.agencies.id }).from(schema.agencies).where(eq(schema.agencies.status, "active")),
  );
  return rows.map((r) => r.id);
}

const documents = new Worker<ScanJob>(
  DOCUMENTS_QUEUE,
  async (job) => {
    const outcome = await scanDocument(job.data.agencyId, job.data.documentId, clamd);
    return { outcome };
  },
  { connection, concurrency: 4 },
);

documents.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[documents] scan ${job.data.documentId} failed (attempt ${job.attemptsMade}):`, err.message);
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await markScanFailed(job.data.agencyId, job.data.documentId, err.message).catch((e: unknown) =>
      console.error("[documents] could not mark scan failed", e),
    );
  }
});

const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
await maintenanceQueue.upsertJobScheduler("sweep-pending-scans", { every: 5 * 60_000 }, { name: "sweep-pending-scans" });
// 02:00 SAST
await maintenanceQueue.upsertJobScheduler("usage-snapshot", { pattern: "0 2 * * *", tz: "Africa/Johannesburg" }, { name: "usage-snapshot" });

const maintenance = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    const agencies = await activeAgencyIds();
    if (job.name === "sweep-pending-scans") {
      let queued = 0;
      for (const agencyId of agencies) {
        for (const documentId of await stalePendingDocuments(agencyId)) {
          if (await enqueueScan({ agencyId, documentId })) queued++;
        }
      }
      return { queued };
    }
    if (job.name === "usage-snapshot") {
      for (const agencyId of agencies) await snapshotUsage(agencyId);
      return { agencies: agencies.length };
    }
    throw new Error(`unknown maintenance job ${job.name}`);
  },
  { connection, concurrency: 1 },
);

console.log(`[worker] ready (env=${config.NODE_ENV}, clamd=${clamd.host}:${clamd.port})`);

async function shutdown(signal: string) {
  console.log(`[worker] ${signal}: finishing current jobs`);
  await Promise.allSettled([documents.close(), maintenance.close(), maintenanceQueue.close()]);
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
