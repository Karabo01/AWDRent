import { env } from "@awdrent/config";
import { type ConnectionOptions, Queue } from "bullmq";

// Job queues shared by the web app (producer) and the worker (consumer).
// Every job carries the agencyId it belongs to; the worker runs it inside
// withAgency() for that agency only.

export const DOCUMENTS_QUEUE = "documents";
export const MAINTENANCE_QUEUE = "maintenance";

/** "scan" jobs carry documentId; "scan-logo" jobs carry logoKey. */
export interface ScanJob {
  agencyId: string;
  documentId?: string;
  logoKey?: string;
}

export function redisConnection(): ConnectionOptions {
  const url = new URL(env().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    username: url.username || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

let documentsQueue: Queue<ScanJob> | undefined;

function queue(): Queue<ScanJob> {
  documentsQueue ??= new Queue<ScanJob>(DOCUMENTS_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return documentsQueue;
}

/**
 * Queues a virus scan. Failure to queue is not fatal: the worker's sweep
 * picks up documents left pending.
 */
export async function enqueueScan(job: { agencyId: string; documentId: string }): Promise<boolean> {
  try {
    // jobId de-duplicates repeated requests for the same document. BullMQ
    // waits indefinitely for Redis, so give up after a few seconds instead
    // of hanging the upload; the sweep re-queues it later.
    await Promise.race([
      queue().add("scan", job, { jobId: `scan-${job.documentId}` }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis did not answer within 3s")), 3_000).unref()),
    ]);
    return true;
  } catch (err) {
    console.error("[queue] could not enqueue scan; the sweep will retry", err);
    return false;
  }
}

/** Queues the virus scan of a newly uploaded agency logo (D50). */
export async function enqueueLogoScan(job: { agencyId: string; logoKey: string }): Promise<boolean> {
  try {
    await Promise.race([
      queue().add("scan-logo", job, { jobId: `scan-logo-${job.logoKey.replace(/[^a-z0-9-]/gi, "-")}` }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis did not answer within 3s")), 3_000).unref()),
    ]);
    return true;
  } catch (err) {
    console.error("[queue] could not enqueue logo scan", err);
    return false;
  }
}
