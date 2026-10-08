import { env } from "@awdrent/config";
import { scanLogo } from "@awdrent/core/branding";
import { markScanFailed, scanDocument, stalePendingDocuments } from "@awdrent/core/documents";
import { DOCUMENTS_QUEUE, enqueueScan, MAINTENANCE_QUEUE, redisConnection, type ScanJob } from "@awdrent/core/queue";
import { runDailyBilling } from "@awdrent/core/ledger";
import { deliverDue } from "@awdrent/core/messages";
import { issueReceipts } from "@awdrent/core/receipts";
import { snapshotUsage } from "@awdrent/core/usage";
import { closeDb, schema, withPlatform } from "@awdrent/db";
import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";

// Background worker. Every job names its agency, and all agency data is read
// and written inside withAgency() for that agency only.
//
// Queues:
//   documents    virus scan, then promote or delete (retried 5×, then marked failed)
//   maintenance  repeatable: daily billing (00:15 and 06:15), receipts (every minute),
//                message delivery (every 20 s), re-queue stuck scans (every 5 min),
//                usage snapshot (nightly)

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
    if (job.name === "scan-logo") return { outcome: await scanLogo(job.data.agencyId, job.data.logoKey!, clamd) };
    return { outcome: await scanDocument(job.data.agencyId, job.data.documentId!, clamd) };
  },
  { connection, concurrency: 4 },
);

documents.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[documents] scan ${job.data.documentId ?? job.data.logoKey} failed (attempt ${job.attemptsMade}):`, err.message);
  if (job.attemptsMade >= (job.opts.attempts ?? 1) && job.data.documentId) {
    await markScanFailed(job.data.agencyId, job.data.documentId, err.message).catch((e: unknown) =>
      console.error("[documents] could not mark scan failed", e),
    );
  }
});

const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
// Rent and escalations (D44, D46). Idempotent, so a second run catches up a missed one
await maintenanceQueue.upsertJobScheduler(
  "daily-billing",
  { pattern: "15 0,6 * * *", tz: "Africa/Johannesburg" },
  { name: "daily-billing" },
);
// Receipts for newly approved payments, and cancelling those of reversed ones
await maintenanceQueue.upsertJobScheduler("issue-receipts", { every: 60_000 }, { name: "issue-receipts" });
// Sends due messages; retries and quiet hours are tracked on the message rows
await maintenanceQueue.upsertJobScheduler("deliver-messages", { every: 20_000 }, { name: "deliver-messages" });
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
    if (job.name === "daily-billing") {
      let escalated = 0;
      let raised = 0;
      // One agency failing must not stop billing for the others
      for (const agencyId of agencies) {
        try {
          const r = await runDailyBilling(agencyId);
          escalated += r.escalated;
          raised += r.raised;
        } catch (err) {
          console.error(`[billing] agency ${agencyId} failed:`, err);
        }
      }
      return { escalated, raised };
    }
    if (job.name === "issue-receipts") {
      let issued = 0;
      for (const agencyId of agencies) {
        try {
          issued += (await issueReceipts(agencyId)).issued;
        } catch (err) {
          console.error(`[receipts] agency ${agencyId} failed:`, err);
        }
      }
      return { issued };
    }
    if (job.name === "deliver-messages") {
      const totals = { sent: 0, failed: 0, retrying: 0 };
      for (const agencyId of agencies) {
        try {
          const r = await deliverDue(agencyId);
          totals.sent += r.sent;
          totals.failed += r.failed;
          totals.retrying += r.retrying;
        } catch (err) {
          console.error(`[messages] agency ${agencyId} failed:`, err);
        }
      }
      return totals;
    }
    if (job.name === "usage-snapshot") {
      for (const agencyId of agencies) await snapshotUsage(agencyId);
      return { agencies: agencies.length };
    }
    throw new Error(`unknown maintenance job ${job.name}`);
  },
  // Two at a time, so a long billing run does not hold up messages; every job is safe to overlap
  { connection, concurrency: 2 },
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
