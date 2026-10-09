import { env } from "@awdrent/config";
import { receiveEmail } from "@awdrent/core/inbox";
import { enqueueScan } from "@awdrent/core/queue";
import { ImapFlow } from "imapflow";

// Reads the AWDRent POP mailbox (D37, D89). Unread emails are handed to
// receiveEmail() one at a time and marked read once recorded, so a crash
// part-way just means the next run repeats the email (receiveEmail skips
// duplicates by Message-ID). An email that fails twice is flagged and set
// aside as read, so it cannot block the mailbox.

const MAX_PER_RUN = 50;
const MAX_EMAIL_BYTES = 25 * 1024 * 1024;
const RETRIED = "$AwdRentRetry";
const FAILED = "$AwdRentFailed";

export async function readPopInbox(): Promise<{ read: number; converted: number; inbox: number; ignored: number; failed: number }> {
  const e = env();
  const result = { read: 0, converted: 0, inbox: 0, ignored: 0, failed: 0 };
  if (!e.POP_IMAP_HOST || !e.POP_IMAP_USER || !e.POP_IMAP_PASSWORD) return result;
  const client = new ImapFlow({
    host: e.POP_IMAP_HOST,
    port: e.POP_IMAP_PORT,
    secure: e.POP_IMAP_SECURE,
    auth: { user: e.POP_IMAP_USER, pass: e.POP_IMAP_PASSWORD },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock(e.POP_IMAP_MAILBOX);
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(0, MAX_PER_RUN)) {
      const range = String(uid);
      const msg = await client.fetchOne(range, { source: true, size: true, flags: true }, { uid: true });
      if (!msg || !msg.source) continue;
      result.read++;
      if ((msg.size ?? msg.source.length) > MAX_EMAIL_BYTES) {
        console.warn(`[pop-inbox] email ${uid} is larger than 25 MB; set aside`);
        await client.messageFlagsAdd(range, ["\\Seen", FAILED], { uid: true });
        result.failed++;
        continue;
      }
      try {
        const outcome = await receiveEmail(msg.source);
        if (outcome.outcome === "converted" || outcome.outcome === "inbox") {
          for (const documentId of outcome.documentIds) await enqueueScan({ agencyId: outcome.agencyId, documentId });
          result[outcome.outcome]++;
        } else {
          // Not for an agency, or already recorded
          result.ignored++;
        }
        await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
      } catch (err) {
        const second = msg.flags?.has(RETRIED);
        console.error(`[pop-inbox] email ${uid} failed${second ? " again; set aside" : "; will retry"}:`, err);
        await client.messageFlagsAdd(range, second ? ["\\Seen", FAILED] : [RETRIED], { uid: true });
        result.failed++;
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return result;
}
