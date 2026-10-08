import { createHash } from "node:crypto";
import { type AgencyContext, schema, withAgency } from "@awdrent/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "./audit";
import { logoFile } from "./branding";
import { todayInSouthAfrica } from "./billing";
import { getLedger } from "./ledger";
import { agencyUrl, primaryTenantId, send, unitName } from "./messages";
import { messageBalance, messageMoney } from "./messaging/render";
import { formatCents } from "./money";
import type { Brand } from "./pdf/branded";
import { renderReceipt, renderStatement } from "./pdf/documents";
import { type Actor, assertLeaseInScope, authorise, NotFoundError } from "./portfolio";
import { deleteObject, putGenerated } from "./storage";

// Receipts (spec; Rental Housing Act) and on-demand statements, as branded
// PDFs (D50, D60). The worker issues a receipt for every approved payment
// received (bank, POP, manual), numbered per agency, and cancels the receipt
// of a payment that is later reversed.

const RECEIPTED_SOURCES = ["bank_import", "pop", "manual"] as const;

/** Built-in PDF fonts cannot draw the narrow no-break space en-ZA uses. */
const NON_BREAKING_SPACES = new RegExp(`[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`, "g");
export const pdfMoney = (cents: number) => formatCents(cents).replace(NON_BREAKING_SPACES, " ");
const longDate = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const pdfDate = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`));

interface ChargeLike {
  id: string;
  dueDate: string;
  createdAt: Date;
  amountCents: number;
  description: string;
  voidedAt: Date | null;
}
interface PaymentLike {
  id: string;
  paidOn: string;
  createdAt: Date;
  amountCents: number;
  status: string;
}

/**
 * What one payment paid for, oldest charge first (D34): all approved
 * payments in date order fill the charges in due-date order, and this
 * payment covers its own slice of that running total.
 */
export function paymentCoverage(charges: ChargeLike[], payments: PaymentLike[], paymentId: string) {
  const live = charges.filter((c) => !c.voidedAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.getTime() - b.createdAt.getTime());
  const paid = payments
    .filter((p) => p.status === "approved")
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.getTime() - b.createdAt.getTime());
  let start = 0;
  for (const p of paid) {
    if (p.id === paymentId) break;
    start += p.amountCents;
  }
  const payment = paid.find((p) => p.id === paymentId);
  if (!payment) return { allocations: [], creditCents: 0 };
  const end = start + payment.amountCents;
  const allocations: { description: string; amountCents: number }[] = [];
  let cursor = 0;
  for (const c of live) {
    const from = Math.max(cursor, start);
    const to = Math.min(cursor + c.amountCents, end);
    if (to > from) allocations.push({ description: c.description, amountCents: to - from });
    cursor += c.amountCents;
  }
  const covered = allocations.reduce((s, a) => s + a.amountCents, 0);
  return { allocations, creditCents: payment.amountCents - covered };
}

async function loadBrand(agencyId: string): Promise<Brand> {
  const [a] = await withAgency({ agencyId, readOnly: true }, (tx) => tx.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId)));
  if (!a) throw new Error("agency not found");
  const logo = await logoFile({ id: a.id, logo_key: a.logoKey }).catch(() => null);
  return {
    name: a.name,
    colour: a.brandColour,
    logo: logo ? { data: Buffer.from(logo.bytes), format: logo.contentType === "image/png" ? "png" : "jpg" } : null,
    legalName: a.legalName,
    registrationNo: a.registrationNo,
    ffcNumber: a.ffcNumber,
    vatNumber: a.vatNumber,
    physicalAddress: a.physicalAddress,
    contactPhone: a.contactPhone,
    contactEmail: a.contactEmail,
  };
}

/** Lease details printed on receipts and statements. */
async function leaseParticulars(agencyId: string, leaseId: string) {
  return withAgency({ agencyId, readOnly: true }, async (tx) => {
    const [row] = await tx
      .select({ lease: schema.leases, unit: schema.units.label, property: schema.properties })
      .from(schema.leases)
      .innerJoin(schema.units, eq(schema.units.id, schema.leases.unitId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(eq(schema.leases.id, leaseId));
    const tenants = await tx
      .select({ name: schema.tenants.fullName })
      .from(schema.leaseTenants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leaseTenants.tenantId))
      .where(eq(schema.leaseTenants.leaseId, leaseId))
      .orderBy(desc(schema.leaseTenants.isPrimary), asc(schema.tenants.fullName));
    const p = row!.property;
    const dwelling = [`${row!.unit}, ${p.name}`, p.addressLine1 !== p.name ? p.addressLine1 : null, p.suburb, p.city].filter(Boolean).join(", ");
    return { lease: row!.lease, dwelling, tenantNames: tenants.map((t) => t.name) };
  });
}

async function nextReceiptNumber(agencyId: string): Promise<string> {
  return withAgency({ agencyId }, async (tx) => {
    const [a] = await tx.select({ prefix: schema.agencies.eftPrefix }).from(schema.agencies).where(eq(schema.agencies.id, agencyId));
    const [row] = await tx
      .insert(schema.receiptSequences)
      .values({ lastValue: 1 })
      .onConflictDoUpdate({ target: schema.receiptSequences.agencyId, set: { lastValue: sql`${schema.receiptSequences.lastValue} + 1` } })
      .returning({ n: schema.receiptSequences.lastValue });
    return `${a!.prefix}-R${String(row!.n).padStart(6, "0")}`;
  });
}

const METHOD: Record<string, string> = { bank_import: "EFT", pop: "EFT", manual: "EFT" };

/**
 * Worker step for one agency: issue receipts for approved payments that do
 * not have one yet, and cancel receipts of reversed payments. Idempotent.
 */
export async function issueReceipts(agencyId: string, limit = 50): Promise<{ issued: number; cancelled: number }> {
  const cancelled = await withAgency({ agencyId }, async (tx) => {
    const reversed = await tx
      .select({ id: schema.receipts.id, leaseId: schema.receipts.leaseId, number: schema.receipts.receiptNumber, reason: schema.payments.reversalReason })
      .from(schema.receipts)
      .innerJoin(schema.payments, eq(schema.payments.id, schema.receipts.paymentId))
      .where(and(eq(schema.payments.status, "reversed"), isNull(schema.receipts.cancelledAt)));
    for (const r of reversed) {
      await tx
        .update(schema.receipts)
        .set({ cancelledAt: sql`now()`, cancelReason: `Payment reversed: ${r.reason ?? ""}`.trim() })
        .where(eq(schema.receipts.id, r.id));
      await audit(tx, { action: "receipt.cancelled", entity: "lease", entityId: r.leaseId, after: { receiptNumber: r.number } });
    }
    return reversed.length;
  });

  const due = await withAgency({ agencyId, readOnly: true }, (tx) =>
    tx
      .select({ payment: schema.payments })
      .from(schema.payments)
      .leftJoin(schema.receipts, eq(schema.receipts.paymentId, schema.payments.id))
      .where(and(eq(schema.payments.status, "approved"), inArray(schema.payments.source, [...RECEIPTED_SOURCES]), isNull(schema.receipts.id)))
      .orderBy(asc(schema.payments.paidOn))
      .limit(limit),
  );
  if (due.length === 0) return { issued: 0, cancelled };

  const brand = await loadBrand(agencyId);
  const today = todayInSouthAfrica();
  let issued = 0;
  for (const { payment } of due) {
    const particulars = await leaseParticulars(agencyId, payment.leaseId);
    const { charges, payments } = await withAgency({ agencyId, readOnly: true }, async (tx) => ({
      charges: await tx.select().from(schema.charges).where(eq(schema.charges.leaseId, payment.leaseId)),
      payments: await tx.select().from(schema.payments).where(eq(schema.payments.leaseId, payment.leaseId)),
    }));
    const coverage = paymentCoverage(charges, payments, payment.id);
    // Balance straight after this payment: charges due by then minus payments up to and including it
    const upTo = payments.filter((p) => p.status === "approved" && (p.paidOn < payment.paidOn || (p.paidOn === payment.paidOn && p.createdAt <= payment.createdAt)));
    const charged = charges.filter((c) => !c.voidedAt && c.dueDate <= payment.paidOn).reduce((s, c) => s + c.amountCents, 0);
    const balanceAfter = charged - upTo.reduce((s, p) => s + p.amountCents, 0);
    const receiptNumber = await nextReceiptNumber(agencyId);
    const pdf = await renderReceipt(brand, {
      receiptNumber,
      issuedOn: pdfDate(today),
      paidOn: pdfDate(payment.paidOn),
      amount: pdfMoney(payment.amountCents),
      tenantNames: particulars.tenantNames,
      dwelling: particulars.dwelling,
      eftReference: particulars.lease.eftReference,
      method: METHOD[payment.source] ?? "EFT",
      allocations: coverage.allocations.map((a) => ({ description: a.description, amount: pdfMoney(a.amountCents) })),
      creditCarried: coverage.creditCents > 0 ? pdfMoney(coverage.creditCents) : null,
      balanceAfter: pdfMoney(balanceAfter),
    });
    const bytes = new Uint8Array(pdf);
    const key = await putGenerated(agencyId, bytes, "application/pdf", "pdf");
    try {
      await withAgency({ agencyId }, async (tx) => {
        const [doc] = await tx
          .insert(schema.documents)
          .values({
            leaseId: payment.leaseId,
            kind: "receipt",
            filename: `Receipt ${receiptNumber}.pdf`,
            contentType: "application/pdf",
            sizeBytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            fileKey: key,
            status: "clean",
            scanResult: "generated",
            scannedAt: sql`now()`,
          })
          .returning({ id: schema.documents.id });
        await tx.insert(schema.receipts).values({
          paymentId: payment.id,
          leaseId: payment.leaseId,
          receiptNumber,
          amountCents: payment.amountCents,
          documentId: doc!.id,
        });
        await audit(tx, { action: "receipt.issued", entity: "lease", entityId: payment.leaseId, after: { receiptNumber, paymentId: payment.id, amountCents: payment.amountCents } });
        // payment_confirmed, with the receipt attached to the email (spec)
        const tenantId = await primaryTenantId(tx, payment.leaseId);
        if (tenantId) {
          await send(tx, {
            recipient: { kind: "tenant", tenantId },
            templateKey: "payment_confirmed",
            leaseId: payment.leaseId,
            attachmentDocumentId: doc!.id,
            variables: {
              amount: messageMoney(payment.amountCents),
              unit: await unitName(tx, payment.leaseId),
              balance: messageBalance(balanceAfter),
              link: await agencyUrl(tx, `/r/${encodeURIComponent(receiptNumber)}`),
              receipt_number: receiptNumber,
            },
          });
        }
      });
      issued++;
    } catch (err) {
      // Another run receipted this payment first; drop our copy of the file
      await deleteObject(key).catch(() => undefined);
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code !== "23505") throw err;
    }
  }
  return { issued, cancelled };
}

export async function listReceipts(actor: Actor, leaseId: string) {
  authorise(actor, "ledger.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    await assertLeaseInScope(tx, actor, leaseId);
    return tx.select().from(schema.receipts).where(eq(schema.receipts.leaseId, leaseId)).orderBy(desc(schema.receipts.issuedAt));
  });
}

/** A lease statement as a branded PDF, generated on request (spec). Audited. */
export async function statementPdf(actor: Actor, leaseId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  return renderStatementPdf(actor.ctx, leaseId, await getLedger(actor, leaseId));
}

/** The statement PDF for a lease the caller may see (staff above, the portal), audited. */
export async function renderStatementPdf(
  ctx: AgencyContext,
  leaseId: string,
  ledger: Awaited<ReturnType<typeof getLedger>>,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const particulars = await leaseParticulars(ctx.agencyId, leaseId);
  const today = todayInSouthAfrica();
  const pdf = await renderStatement(await loadBrand(ctx.agencyId), {
    issuedOn: pdfDate(today),
    tenantNames: particulars.tenantNames,
    dwelling: particulars.dwelling,
    eftReference: particulars.lease.eftReference,
    lines: ledger.lines.map((l) => ({
      date: l.date,
      description: l.note ? `${l.description} (${l.note})` : l.description,
      charge: l.debitCents ? pdfMoney(l.debitCents) : "",
      payment: l.creditCents ? pdfMoney(l.creditCents) : "",
      balance: pdfMoney(l.balanceCents),
      struck: !l.counts,
    })),
    balance: pdfMoney(ledger.balanceCents),
    overdue: pdfMoney(ledger.overdueCents),
  });
  await withAgency(ctx, (tx) => audit(tx, { action: "statement.generated", entity: "lease", entityId: leaseId }));
  return { bytes: new Uint8Array(pdf), filename: `Statement ${particulars.lease.eftReference} ${today}.pdf` };
}

/** The lease a receipt belongs to, for the short receipt link in messages (/r/{number}). */
export async function receiptLeaseId(actor: Actor, receiptNumber: string): Promise<string> {
  authorise(actor, "ledger.view");
  return withAgency({ ...actor.ctx, readOnly: true }, async (tx) => {
    const [r] = await tx.select({ leaseId: schema.receipts.leaseId }).from(schema.receipts).where(eq(schema.receipts.receiptNumber, receiptNumber));
    if (!r) throw new NotFoundError("Receipt");
    await assertLeaseInScope(tx, actor, r.leaseId);
    return r.leaseId;
  });
}
