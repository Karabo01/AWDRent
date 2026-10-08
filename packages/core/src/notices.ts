import { schema, type Tx, withAgency } from "@awdrent/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import { addMonths, dueDateFor, monthStart, monthsToBill, todayInSouthAfrica } from "./billing";
import { escalatedRent } from "./leases";
import { allocate } from "./ledger";
import { agencyUrl, leaseContact, primaryTenantId, type Recipient, send, unitName } from "./messages";
import { messageMoney } from "./messaging/render";
import { type Actor, assertLeaseInScope, authorise } from "./portfolio";

// The daily notices run (spec: "a daily scheduler at 07:30 creates the
// day's reminder, overdue and expiry jobs"; D72–D75). For each live lease it
// works out which catalogue messages are due today, records each one once in
// scheduled_notices (so a second run, or a run after downtime, never repeats
// one) and sends it through the messaging service, which applies opt-ins and
// quiet hours.

type Lease = typeof schema.leases.$inferSelect;
type Charge = typeof schema.charges.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;

export type NoticeKind = "rent_due_reminder" | "rent_due_today" | "overdue_1" | "overdue_7" | "overdue_14" | "lease_expiry" | "escalation_notice";

export interface DueNotice {
  /** Unique per lease: the notice is sent once for this key */
  key: string;
  kind: NoticeKind;
  amountCents?: number;
  dueDate?: string;
  endDate?: string;
  escalationDate?: string;
}

const LIVE = new Set(["active", "notice_given"]);
const OVERDUE_STAGES = [14, 7, 1] as const;
export const REMINDER_DAYS_BEFORE = 5;
const EXPIRY_STAGES = [30, 60] as const;
const ESCALATION_NOTICE_DAYS = 60;

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
export const addDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10);

/** Overdue reminders are paused from when staff paused them until the "until" date, inclusive (D73). */
export function remindersPaused(lease: Pick<Lease, "remindersPausedAt" | "remindersPausedUntil">, today: string): boolean {
  return !!lease.remindersPausedAt && (!lease.remindersPausedUntil || today <= lease.remindersPausedUntil);
}

/** The rent a month will be charged: escalated if the escalation will have applied by then (D46). */
function rentFor(lease: Lease, month: string): number {
  if (lease.escalationBps !== null && lease.escalationDate && lease.escalationDate <= month) return escalatedRent(lease.rentCents, lease.escalationBps);
  return lease.rentCents;
}

/**
 * Which notices a lease is due on `today`. Pure, so the rules are unit
 * tested; the caller drops those already sent.
 *
 *  rent_due_reminder  within 5 days before the due date, if anything will be owed then
 *  rent_due_today     on the due date, if unpaid
 *  overdue_1/7/14     by the age of the oldest unpaid charge; only the highest
 *                     stage reached, once per charge; not while paused or while
 *                     a proof of payment waits for review (D73)
 *  lease_expiry       60 and 30 days before a fixed end date (not after notice is given)
 *  escalation_notice  within 60 days before an escalation
 */
export function noticesDue(lease: Lease, charges: Charge[], payments: Payment[], today: string, opts: { popPending: boolean }): DueNotice[] {
  if (!LIVE.has(lease.status)) return [];
  const notices: DueNotice[] = [];
  const paid = payments.filter((p) => p.status === "approved").reduce((s, p) => s + p.amountCents, 0);
  const alloc = allocate(charges, paid);
  const outstandingBy = (date: string) => alloc.charges.filter((c) => c.dueDate <= date).reduce((s, c) => s + c.outstandingCents, 0);
  const raised = (month: string) => charges.some((c) => c.type === "rent" && c.period === month && !c.voidedAt);

  // Rent due soon, and due today
  for (const month of [monthStart(today), addMonths(monthStart(today), 1)]) {
    const due = dueDateFor(month, lease.dueDay);
    if (!monthsToBill(lease, due).includes(month)) continue;
    const owed = outstandingBy(due) + (raised(month) ? 0 : rentFor(lease, month) - alloc.creditCents);
    if (owed <= 0) continue;
    const daysToDue = daysBetween(today, due);
    if (daysToDue > 0 && daysToDue <= REMINDER_DAYS_BEFORE) notices.push({ key: `rent_due_reminder:${month}`, kind: "rent_due_reminder", amountCents: owed, dueDate: due });
    if (daysToDue === 0) notices.push({ key: `rent_due_today:${month}`, kind: "rent_due_today", amountCents: owed, dueDate: due });
  }

  // Overdue escalation
  const oldest = alloc.charges.find((c) => c.outstandingCents > 0 && c.dueDate < today);
  if (oldest && !remindersPaused(lease, today) && !opts.popPending) {
    const days = daysBetween(oldest.dueDate, today);
    const stage = OVERDUE_STAGES.find((s) => days >= s);
    const overdue = alloc.charges.filter((c) => c.dueDate < today).reduce((s, c) => s + c.outstandingCents, 0);
    if (stage) notices.push({ key: `overdue_${stage}:${oldest.id}`, kind: `overdue_${stage}`, amountCents: overdue, dueDate: oldest.dueDate });
  }

  // Lease ending
  if (lease.status === "active" && lease.endDate) {
    const daysToEnd = daysBetween(today, lease.endDate);
    const stage = EXPIRY_STAGES.find((s) => daysToEnd > 0 && daysToEnd <= s);
    if (stage) notices.push({ key: `lease_expiry_${stage}:${lease.endDate}`, kind: "lease_expiry", endDate: lease.endDate });
  }

  // Escalation coming
  if (lease.escalationBps !== null && lease.escalationDate && (!lease.endDate || lease.escalationDate <= lease.endDate)) {
    const daysTo = daysBetween(today, lease.escalationDate);
    if (daysTo > 0 && daysTo <= ESCALATION_NOTICE_DAYS) {
      notices.push({
        key: `escalation_notice:${lease.escalationDate}`,
        kind: "escalation_notice",
        amountCents: escalatedRent(lease.rentCents, lease.escalationBps),
        escalationDate: lease.escalationDate,
      });
    }
  }
  return notices;
}

const dayMonth = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Agents whose portfolio holds the lease's property, or the agency's admins if none (D74). */
async function responsibleStaff(tx: Tx, leaseId: string): Promise<{ agents: string[]; admins: string[] }> {
  const agents = await tx
    .select({ id: schema.users.id })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.agentPortfolios, eq(schema.agentPortfolios.propertyId, schema.units.propertyId))
    .innerJoin(schema.users, eq(schema.users.id, schema.agentPortfolios.userId))
    .where(and(eq(schema.leases.id, leaseId), eq(schema.users.active, true)));
  const admins = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true)));
  return { agents: [...new Set(agents.map((a) => a.id))], admins: admins.map((a) => a.id) };
}

async function ownerOf(tx: Tx, leaseId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.properties.ownerId })
    .from(schema.leases)
    .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
    .where(eq(schema.leases.id, leaseId));
  return row?.id ?? null;
}

async function sendNotice(tx: Tx, lease: Lease, notice: DueNotice): Promise<number> {
  const unit = await unitName(tx, lease.id);
  const tenantId = await primaryTenantId(tx, lease.id);
  const tenant: Recipient[] = tenantId ? [{ kind: "tenant", tenantId }] : [];
  const amount = messageMoney(notice.amountCents ?? 0);
  const base = { leaseId: lease.id };
  let sent = 0;
  const to = async (recipients: Recipient[], variables: Record<string, string>, copyOf?: (r: Recipient) => string | undefined) => {
    for (const recipient of recipients) {
      await send(tx, { ...base, recipient, templateKey: notice.kind, variables, copyOf: copyOf?.(recipient) });
      sent++;
    }
  };
  const staff = async () => {
    const { agents, admins } = await responsibleStaff(tx, lease.id);
    return { responsible: (agents.length ? agents : admins).map((userId): Recipient => ({ kind: "staff", userId })), agents, admins };
  };

  switch (notice.kind) {
    case "rent_due_reminder":
      await to(tenant, {
        amount,
        unit,
        due_date: dayMonth.format(asDate(notice.dueDate!)),
        eft_ref: lease.eftReference,
        short_link: await agencyUrl(tx, "/p/pay"),
      });
      break;
    case "rent_due_today":
      await to(tenant, { amount, eft_ref: lease.eftReference, portal_link: await agencyUrl(tx, "/p") });
      break;
    case "overdue_1":
      await to(tenant, { balance: amount, eft_ref: lease.eftReference, portal_link: await agencyUrl(tx, "/p") });
      break;
    case "overdue_7": {
      const vars = { balance: amount, ...(await leaseContact(tx, lease.id)) };
      await to(tenant, vars);
      // The agent gets a copy of what the tenant was sent
      if (tenantId) {
        const [t] = await tx.select({ name: schema.tenants.fullName }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
        const tenantFirst = t!.name.trim().split(/\s+/)[0]!;
        await to((await staff()).responsible, { ...vars, name: tenantFirst }, () => `${t!.name} (${unit})`);
      }
      break;
    }
    case "overdue_14": {
      const [t] = tenantId ? await tx.select({ name: schema.tenants.fullName }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)) : [];
      const { agents, admins } = await staff();
      const recipients = [...new Set([...agents, ...admins])].map((userId): Recipient => ({ kind: "staff", userId }));
      await to(recipients, { tenant: t?.name ?? lease.eftReference, unit, balance: amount });
      break;
    }
    case "lease_expiry": {
      const owner = await ownerOf(tx, lease.id);
      const recipients: Recipient[] = [...tenant, ...(owner ? [{ kind: "owner" as const, ownerId: owner }] : []), ...(await staff()).responsible];
      await to(recipients, { unit, end_date: fullDate.format(asDate(notice.endDate!)) });
      break;
    }
    case "escalation_notice": {
      const owner = await ownerOf(tx, lease.id);
      await to([...tenant, ...(owner ? [{ kind: "owner" as const, ownerId: owner }] : [])], {
        unit,
        date: fullDate.format(asDate(notice.escalationDate!)),
        new_amount: amount,
      });
      break;
    }
  }
  return sent;
}

/**
 * The daily run for one agency (worker, 07:30 and a 12:30 catch-up). Each
 * lease is handled in its own transaction, so one bad lease does not stop
 * the rest. Returns how many notices were sent.
 */
export async function runDailyNotices(agencyId: string, today = todayInSouthAfrica()): Promise<{ notices: number; messages: number; failed: number }> {
  const leases = await withAgency({ agencyId, readOnly: true }, (tx) =>
    tx.select({ id: schema.leases.id }).from(schema.leases).where(inArray(schema.leases.status, ["active", "notice_given"])),
  );
  const result = { notices: 0, messages: 0, failed: 0 };
  for (const { id } of leases) {
    try {
      await withAgency({ agencyId }, async (tx) => {
        const [lease] = await tx.select().from(schema.leases).where(eq(schema.leases.id, id));
        if (!lease) return;
        const charges = await tx.select().from(schema.charges).where(eq(schema.charges.leaseId, id));
        const payments = await tx.select().from(schema.payments).where(eq(schema.payments.leaseId, id));
        const [pending] = await tx
          .select({ id: schema.proofsOfPayment.id })
          .from(schema.proofsOfPayment)
          .where(and(eq(schema.proofsOfPayment.leaseId, id), eq(schema.proofsOfPayment.status, "pending")))
          .limit(1);
        for (const notice of noticesDue(lease, charges, payments, today, { popPending: !!pending })) {
          // Claim the notice; a concurrent run waits here and then skips it
          const claimed = await tx
            .insert(schema.scheduledNotices)
            .values({ leaseId: id, noticeKey: notice.key, sentOn: today })
            .onConflictDoNothing()
            .returning({ id: schema.scheduledNotices.id });
          if (claimed.length === 0) continue;
          result.messages += await sendNotice(tx, lease, notice);
          result.notices++;
        }
      });
    } catch (err) {
      result.failed++;
      console.error(`[notices] lease ${id} failed:`, err);
    }
  }
  return result;
}

// ─── Pausing overdue reminders (spec; D73) ─────────────────────────────

export const pauseSchema = z.object({
  reason: z.string().trim().min(3, "Say why, e.g. the payment arrangement").max(300),
  until: z
    .string()
    .trim()
    .transform((s) => s || null)
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable()),
});

export async function pauseReminders(actor: Actor, leaseId: string, input: z.infer<typeof pauseSchema>, today = todayInSouthAfrica()): Promise<void> {
  authorise(actor, "reminders.pause");
  if (input.until && input.until < today) throw new PauseError("The pause must last until today or later.");
  await withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    await tx
      .update(schema.leases)
      .set({ remindersPausedAt: sql`now()`, remindersPausedUntil: input.until, remindersPauseReason: input.reason, remindersPausedBy: actor.userId })
      .where(eq(schema.leases.id, leaseId));
    await audit(tx, { action: "lease.reminders_paused", entity: "lease", entityId: leaseId, after: { reason: input.reason, until: input.until } });
  });
}

export async function resumeReminders(actor: Actor, leaseId: string): Promise<void> {
  authorise(actor, "reminders.pause");
  await withAgency(actor.ctx, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    await tx
      .update(schema.leases)
      .set({ remindersPausedAt: null, remindersPausedUntil: null, remindersPauseReason: null, remindersPausedBy: null })
      .where(eq(schema.leases.id, leaseId));
    await audit(tx, { action: "lease.reminders_resumed", entity: "lease", entityId: leaseId });
  });
}

export class PauseError extends Error {}
